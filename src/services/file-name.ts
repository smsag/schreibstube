/**
 * Whether a name typed into the pane can become a file.
 *
 * The rename and create dialogs used to refuse `\`, `/` and `:` and wave
 * everything else through to the vault, which then refused `?`, `*`, a name
 * starting with a dot, and half a dozen others — with the same generic notice
 * for every one of them. A dialog that says "fine" and an action that then
 * says "no" is a dialog that lied.
 *
 * So the rules the vault applies are written down here, once, where a test
 * can hold them still. They follow what Obsidian itself refuses, plus the two
 * things a filesystem refuses that Obsidian only finds out about afterwards.
 * The characters match `sanitizeFilename`, which strips the same set from a
 * name a model proposed: what one function removes, this one refuses.
 */

/** Why a name was refused. Each one is a sentence in the catalogue. */
export type FileNameProblem =
  | "empty"
  /** A character no filesystem, or Obsidian, takes in a name. */
  | "characters"
  /** A character that would break every link pointing at the file. */
  | "link-characters"
  /** Starts with a dot: the vault hides it and the file vanishes on creation. */
  | "hidden"
  /** Ends with a dot, which Windows drops silently and macOS keeps. */
  | "trailing-dot"
  /** A device name Windows will not create a file under, whatever follows the dot. */
  | "reserved"
  /** More bytes than any common filesystem takes in one name. */
  | "too-long";

/**
 * The most bytes a name may have, in UTF-8.
 *
 * ext4, APFS and NTFS all stop at 255, and the first two count bytes: an
 * umlaut is two of them and an emoji four, so a name of 200 German characters
 * can be over the limit while a count of characters says it is fine. Bytes
 * are the stricter measure on every filesystem the vault could sit on.
 */
export const MAX_FILE_NAME_BYTES = 255;

export type FileNameCheck = { ok: true; name: string } | { ok: false; problem: FileNameProblem };

/** The last segment of a vault path: the file's or folder's own name. */
export function basename(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

const FILESYSTEM_CHARS = /[/\\:*?"<>|]/;
const LINK_CHARS = /[#^[\]]/;
/** `CON`, `NUL`, `COM1` and the rest: on Windows a device, never a file, also as `con.md`. */
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
/** The characters no name and no property key may hold; refusing them is the point. */
// eslint-disable-next-line no-control-regex -- spelt out so the source holds no raw bytes.
export const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Check a name, and hand back the one to use.
 *
 * The returned name is trimmed: surrounding whitespace is never meant, and a
 * name that differs from another only by a trailing space is a trap on every
 * filesystem. What the person typed is not corrected beyond that — a `?` is
 * refused, not removed, because silently changing a name is how a file ends
 * up somewhere its owner cannot find it.
 */
export function checkFileName(raw: string): FileNameCheck {
  const name = raw.trim();

  if (name.length === 0) return { ok: false, problem: "empty" };
  if (new TextEncoder().encode(name).byteLength > MAX_FILE_NAME_BYTES) {
    return { ok: false, problem: "too-long" };
  }
  if (FILESYSTEM_CHARS.test(name) || CONTROL_CHARS.test(name)) {
    return { ok: false, problem: "characters" };
  }
  if (LINK_CHARS.test(name)) return { ok: false, problem: "link-characters" };
  if (name.startsWith(".")) return { ok: false, problem: "hidden" };
  if (name.endsWith(".")) return { ok: false, problem: "trailing-dot" };
  if (WINDOWS_DEVICE.test((name.split(".")[0] ?? "").trimEnd())) {
    return { ok: false, problem: "reserved" };
  }

  return { ok: true, name };
}

/**
 * A folder setting as a vault path: `""` for none, null when it cannot be one.
 *
 * Every folder the plugin writes into, reads templates from or publishes is a
 * setting, and settings live in `data.json`, which a person edits by hand and
 * a sync client carries between devices. A `..` there would reach outside the
 * vault; a segment starting with a dot reaches the config folder, where a note
 * written into `.obsidian/plugins/…` is a plugin's code or settings, and a
 * folder published from there is the vault's private configuration. So a
 * path with an empty or dot-led segment, a backslash or a control character
 * is refused outright rather than repaired into something the person did not
 * write. Slashes at either end and spaces around a segment are only typing.
 */
export function normalizeVaultFolder(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return "";
  if (trimmed.includes("\\") || /\p{Cc}/u.test(trimmed)) return null;

  const segments = trimmed.split("/").map((segment) => segment.trim());
  if (segments.some((segment) => segment === "" || segment.startsWith("."))) return null;
  return segments.join("/");
}
