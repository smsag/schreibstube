/**
 * Which attachments of a received mail go into a note.
 *
 * A received mail is written by whoever sent it: its file names, types and
 * sizes are claims. What is handed over is decided here, before anything is
 * encoded: only kinds of file a note can embed or open, whose bytes begin the
 * way that kind does, under a size a phone can hold, with a name that is only
 * a name. A signature's logos are left out,
 * since every mail from Outlook carries them and nobody imports a mail for
 * them.
 */

/** More files than this in one mail is an archive, not correspondence. */
export const MAX_IMPORT_ATTACHMENTS = 20;

/** One file, decoded. A scanned contract of many pages fits. */
export const MAX_IMPORT_ATTACHMENT_BYTES = 15_000_000;

/** All files of one mail, decoded; the answer is a third larger as base64. */
export const MAX_IMPORT_TOTAL_BYTES = 25_000_000;

/**
 * The whole message as the server stores it, attachments in base64 included.
 * A mail beyond it is not downloaded at all: a cut one would hand over files
 * that end half way.
 */
export const MAX_IMPORT_MESSAGE_BYTES = 40_000_000;

/**
 * Below this, a picture shown inside the text is taken for a signature's logo
 * or a social-media icon. A photo pasted into a mail is many times larger.
 */
export const SIGNATURE_IMAGE_BYTES = 40_000;

/** Longest name kept, extension aside; file systems allow 255 bytes in all. */
export const MAX_NAME_CHARS = 100;

/**
 * Longest name kept in UTF-8, extension included. A hundred characters of
 * Chinese or of emoji are three and four hundred bytes, past what ext4, APFS
 * and a sync client allow, so the file failed to save after it was fetched.
 * Cut on a character, never inside one.
 */
export const MAX_NAME_BYTES = 200;

/**
 * Names Windows reserves for a device, with any extension: a vault synced to
 * Windows cannot hold `CON.pdf` or `nul.tar.pdf`, and a sync client that
 * tries reports an error the person cannot trace back to a mail.
 */
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\.|$)/i;

/**
 * What a kind's bytes begin with, by extension. A sender's name and type are
 * claims, and a program renamed `Rechnung.pdf` is handed to whatever opens
 * PDFs on the device. Each entry is an offset and the bytes found there;
 * a kind matches when all of one alternative match.
 */
const ZIP = [[0, [0x50, 0x4b, 0x03, 0x04]]];
const OLE = [[0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]]];
const ascii = (text) => [...text].map((char) => char.charCodeAt(0));
const MAGIC = new Map([
  ["png", [[[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]]]],
  ["jpg", [[[0, [0xff, 0xd8, 0xff]]]]],
  ["jpeg", [[[0, [0xff, 0xd8, 0xff]]]]],
  ["gif", [[[0, ascii("GIF87a")]], [[0, ascii("GIF89a")]]]],
  [
    "webp",
    [
      [
        [0, ascii("RIFF")],
        [8, ascii("WEBP")]
      ]
    ]
  ],
  [
    "heic",
    ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].map((brand) => [
      [4, ascii(`ftyp${brand}`)]
    ])
  ],
  ["doc", [OLE]],
  ["xls", [OLE]],
  ["ppt", [OLE]],
  ["docx", [ZIP]],
  ["xlsx", [ZIP]],
  ["pptx", [ZIP]],
  ["odt", [ZIP]],
  ["ods", [ZIP]],
  ["odp", [ZIP]]
]);

/** Readers accept a PDF whose header follows some bytes of junk, and so do
 *  scanners that write one; the header has to be within the first kilobyte. */
const PDF_HEADER_WITHIN = 1024;

/** The kinds kept, by extension, with the type they are handed over as. */
const KINDS = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["heic", "image/heic"],
  ["pdf", "application/pdf"],
  ["doc", "application/msword"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["xls", "application/vnd.ms-excel"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["ppt", "application/vnd.ms-powerpoint"],
  ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ["odt", "application/vnd.oasis.opendocument.text"],
  ["ods", "application/vnd.oasis.opendocument.spreadsheet"],
  ["odp", "application/vnd.oasis.opendocument.presentation"]
]);

/** The extension for a type, for a file that came without a usable name. */
const EXTENSION_OF = new Map(
  [...KINDS].filter(([ext]) => ext !== "jpeg").map(([ext, type]) => [type, ext])
);

/**
 * Split a parsed mail's attachments into what is handed over and what is
 * named as left out. `attachments` is mailparser's list; each kept one is
 * `{filename, contentType, content}` with the bytes still a Buffer.
 */
export function chooseImportAttachments(attachments) {
  const kept = [];
  const skipped = [];
  const taken = new Set();
  let total = 0;

  for (const [index, attachment] of (Array.isArray(attachments) ? attachments : []).entries()) {
    const content = Buffer.isBuffer(attachment?.content) ? attachment.content : null;
    if (!content) continue;

    if (isSignatureFile(attachment)) continue;
    const kind = kindOf(attachment.filename, attachment.contentType);
    const shown = displayName(attachment.filename, index);
    if (!kind) {
      skipped.push({ filename: shown, reason: "type" });
      continue;
    }
    if (isSignatureImage(attachment, kind.contentType, content.length)) continue;
    if (content.length > MAX_IMPORT_ATTACHMENT_BYTES) {
      skipped.push({ filename: shown, reason: "size" });
      continue;
    }
    if (!contentMatches(content, kind.extension)) {
      skipped.push({ filename: shown, reason: "content" });
      continue;
    }
    if (kept.length >= MAX_IMPORT_ATTACHMENTS || total + content.length > MAX_IMPORT_TOTAL_BYTES) {
      skipped.push({ filename: shown, reason: "limit" });
      continue;
    }

    const filename = unique(safeFilename(attachment.filename, kind.extension, index), taken);
    taken.add(filename.toLowerCase());
    total += content.length;
    kept.push({ filename, contentType: kind.contentType, content });
  }

  return { kept, skipped };
}

/**
 * A picture shown inside the mail's text and small: a signature's logo. A
 * picture sent as an attachment of its own is kept at any size.
 */
export function isSignatureImage(attachment, contentType, bytes) {
  if (!contentType.startsWith("image/")) return false;
  const inline =
    attachment?.related === true ||
    attachment?.contentDisposition === "inline" ||
    (typeof attachment?.cid === "string" && attachment.cid.length > 0);
  return inline && bytes < SIGNATURE_IMAGE_BYTES;
}

/** An S/MIME signature: proof of the sender, not something they sent. */
function isSignatureFile(attachment) {
  const type = String(attachment?.contentType ?? "").toLowerCase();
  return (
    type.includes("pkcs7-signature") || /\.p7s$/i.test(String(attachment?.filename ?? "").trim())
  );
}

/**
 * A name that is only a name: no folder, nothing that breaks a wiki link or a
 * file system, not hidden, not empty, and ending in the extension of its kind.
 */
export function safeFilename(name, extension, index = 0) {
  const suffix = `.${extension}`;
  const cleaned = cleanName(
    lastSegment(name).replace(new RegExp(`\\.(${extension}|jpeg)$`, "i"), "")
  );
  const bounded = trimEnds([...cleaned].slice(0, MAX_NAME_CHARS).join(""));
  const base = trimEnds(cutToBytes(notADevice(bounded), MAX_NAME_BYTES - suffix.length));
  return `${base || `Anhang ${index + 1}`}${suffix}`;
}

/**
 * Whether a file's bytes begin the way its kind does. A kind without a
 * signature here is not handed over, rather than handed over unchecked.
 */
export function contentMatches(content, extension) {
  if (extension === "pdf") {
    return content.subarray(0, PDF_HEADER_WITHIN).includes("%PDF-");
  }
  const alternatives = MAGIC.get(extension);
  if (!alternatives) return false;
  return alternatives.some((alternative) =>
    alternative.every(
      ([offset, bytes]) =>
        content.length >= offset + bytes.length &&
        bytes.every((byte, i) => content[offset + i] === byte)
    )
  );
}

function lastSegment(name) {
  return String(name ?? "")
    .split(/[\\/]/)
    .pop();
}

/**
 * The characters a name may keep, for a file and for a name shown in a note
 * alike: no control characters, C1 included; no format characters, which
 * hold the bidirectional overrides that show `Rechnung` U+202E `fdp.exe` as
 * `Rechnungexe.pdf`; nothing that breaks a wiki link or a file system.
 */
function cleanName(text) {
  return text
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .normalize("NFC")
    .replace(/[*"<>:|?#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+/, "");
}

/** Not hidden, not ending in a dot or a space, which Windows drops. */
function trimEnds(text) {
  return text.replace(/^[.\s-]+|[.\s]+$/g, "");
}

/** At most `limit` bytes of UTF-8, cut between characters. */
function cutToBytes(text, limit) {
  let used = 0;
  let kept = "";
  for (const char of text) {
    used += Buffer.byteLength(char);
    if (used > limit) break;
    kept += char;
  }
  return kept;
}

/** A device name keeps its letters, behind a mark that makes it a name. */
function notADevice(base) {
  return DEVICE_NAME.test(base) ? `_${base}` : base;
}

function kindOf(filename, contentType) {
  const match = /\.([a-z0-9]{1,5})$/i.exec(String(filename ?? "").trim());
  const byName = match ? match[1].toLowerCase() : null;
  if (byName && KINDS.has(byName)) {
    return { extension: byName, contentType: KINDS.get(byName) };
  }
  const type = String(contentType ?? "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  const extension = EXTENSION_OF.get(type);
  // A name with an extension of another kind is believed over its type: an
  // .exe declared as a PDF is not handed over as one.
  if (extension && !byName) return { extension, contentType: type };
  return null;
}

/**
 * The name a left-out file is called by in the note and the notice: the
 * sender's words, so held to the characters a file name may have. It is not
 * a path, and keeps its extension as sent, since what was left out is the
 * point of naming it.
 */
export function displayName(filename, index) {
  const name = trimEnds(cutToBytes(cleanName(lastSegment(filename)), MAX_NAME_BYTES));
  return name || `Anhang ${index + 1}`;
}

/** Two attachments may share a name; the second becomes "name 2.ext". */
function unique(filename, taken) {
  if (!taken.has(filename.toLowerCase())) return filename;
  const dot = filename.lastIndexOf(".");
  const suffix = filename.slice(dot);
  // Inside both bounds with its number, or the plugin, which holds a name to
  // them again, would cut the number off and write over the first file.
  for (let n = 2; ; n += 1) {
    const mark = ` ${n}`;
    const stem = [...filename.slice(0, dot)].slice(0, MAX_NAME_CHARS - mark.length).join("");
    const candidate = `${trimEnds(cutToBytes(stem, MAX_NAME_BYTES - suffix.length - mark.length))}${mark}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
