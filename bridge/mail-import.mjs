/**
 * Which attachments of a received mail go into a note.
 *
 * A received mail is written by whoever sent it: its file names, types and
 * sizes are claims. What is handed over is decided here, before anything is
 * encoded: only kinds of file a note can embed or open, under a size a phone
 * can hold, with a name that is only a name. A signature's logos are left out,
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
  const base = withoutControl(
    String(name ?? "")
      .split(/[\\/]/)
      .pop()
  )
    .normalize("NFC")
    .replace(new RegExp(`\\.(${extension}|jpeg)$`, "i"), "")
    .replace(/[*"<>:|?#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+|[.\s]+$/g, "")
    .slice(0, MAX_NAME_CHARS)
    .trim();
  return `${base || `Anhang ${index + 1}`}.${extension}`;
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

function displayName(filename, index) {
  const name = withoutControl(String(filename ?? "")).trim();
  return name.slice(0, MAX_NAME_CHARS + 10) || `Anhang ${index + 1}`;
}

/** Text without control characters, which no file name or note line should hold. */
function withoutControl(text) {
  return [...text].filter((char) => char.charCodeAt(0) > 0x1f && char !== "\u007f").join("");
}

/** Two attachments may share a name; the second becomes "name 2.ext". */
function unique(filename, taken) {
  if (!taken.has(filename.toLowerCase())) return filename;
  const dot = filename.lastIndexOf(".");
  for (let n = 2; ; n += 1) {
    const candidate = `${filename.slice(0, dot)} ${n}${filename.slice(dot)}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
