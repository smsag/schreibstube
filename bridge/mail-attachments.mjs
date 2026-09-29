/**
 * The pictures a mail may carry, checked before anything is decoded for good.
 *
 * A note's diagrams cannot be drawn in a mail client, so the plugin draws them
 * and sends them along as attachments. They arrive as base64 inside a JSON body
 * from a client that holds a token, which is not the same as a client that is
 * right: every field is checked, every size is bounded, and a picture has to
 * be the kind of file its name says it is. An attachment that fails is a
 * refused request, never a mail sent without it — the text of that mail would
 * point at a picture that is not there.
 */

/** More pictures than this in one mail is not a note, it is an album. */
export const MAX_ATTACHMENTS = 10;

/** One picture, decoded. A diagram drawn at twice its size stays far below. */
export const MAX_ATTACHMENT_BYTES = 4_000_000;

/** All pictures of one mail, decoded. Most mail servers refuse far larger. */
export const MAX_ATTACHMENTS_TOTAL_BYTES = 10_000_000;

/** The only kind of file that is sent: what a drawing becomes. */
export const ATTACHMENT_TYPES = new Set(["image/png"]);

/** A name a mail client shows and saves as it is: no path, no header tricks. */
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,95}\.png$/;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The attachments of a send request, decoded, or the reason they are refused.
 *
 * Absent means none: a plugin before protocol 5 sends no field at all.
 */
export function checkAttachments(value) {
  if (value === undefined || value === null) return { attachments: [] };
  if (!Array.isArray(value)) return { problem: "attachments must be a list." };
  if (value.length > MAX_ATTACHMENTS) {
    return { problem: `A mail carries at most ${MAX_ATTACHMENTS} attachments.` };
  }

  const attachments = [];
  const names = new Set();
  let total = 0;

  for (const [index, entry] of value.entries()) {
    const label = `attachments[${index}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { problem: `${label} must be an object.` };
    }
    const { filename, contentType, content } = entry;

    if (typeof filename !== "string" || !FILENAME.test(filename)) {
      return { problem: `${label}.filename must be a plain name ending in .png.` };
    }
    if (names.has(filename.toLowerCase())) {
      return { problem: `${label}.filename is used twice.` };
    }
    names.add(filename.toLowerCase());

    if (!ATTACHMENT_TYPES.has(contentType)) {
      return { problem: `${label}.contentType must be image/png.` };
    }

    // Measured before it is decoded: the decoded size is three quarters of the
    // text, so a picture too large is refused without being materialised.
    if (typeof content !== "string" || content.length % 4 !== 0 || !BASE64.test(content)) {
      return { problem: `${label}.content must be base64.` };
    }
    if ((content.length / 4) * 3 > MAX_ATTACHMENT_BYTES + 2) {
      return { problem: `${label} is larger than ${MAX_ATTACHMENT_BYTES} bytes.` };
    }

    const bytes = Buffer.from(content, "base64");
    if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES) {
      return { problem: `${label} is empty or larger than ${MAX_ATTACHMENT_BYTES} bytes.` };
    }
    if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      return { problem: `${label} is not a PNG.` };
    }

    total += bytes.length;
    if (total > MAX_ATTACHMENTS_TOTAL_BYTES) {
      return { problem: `The attachments come to more than ${MAX_ATTACHMENTS_TOTAL_BYTES} bytes.` };
    }
    attachments.push({ filename, contentType, content: bytes });
  }

  return { attachments };
}

/** The largest request body a send with attachments may be: the text's own
 *  allowance, every picture at its limit in base64, and the JSON around them. */
export function maxSendBodyBytes(maxBodyBytes) {
  return maxBodyBytes + Math.ceil((MAX_ATTACHMENTS_TOTAL_BYTES * 4) / 3) + 64_000;
}
