/**
 * A picture described in words, and the note that keeps the words.
 *
 * A vault full of photos cannot be searched by what the photos show: the only
 * text a picture carries is its file name. A vision model is asked for a title,
 * a description, keywords and any visible text, and the answer is kept as an
 * ordinary Markdown note beside the others, so every search in Obsidian can find
 * it and it survives the plugin.
 *
 * Everything here decides and nothing fetches: the prompt, what an answer must
 * look like before a word of it is written, the note, its path and the
 * fingerprint that says whether a picture changed since it was described. The
 * controller sends the picture and writes the file.
 */

/** Bounds on what a description may carry into the vault. A model's answer is
 *  untrusted input, and a runaway one must not become a runaway note. */
export const MAX_DESCRIPTION_TITLE = 80;
export const MAX_DESCRIPTION_CHARS = 1200;
export const MAX_KEYWORDS = 12;
export const MAX_KEYWORD_CHARS = 40;
export const MAX_VISIBLE_TEXT_CHARS = 600;
/** Enough for the JSON of the longest description the bounds allow, in German. */
export const DESCRIPTION_MAX_TOKENS = 900;

export interface ImageDescription {
  title: string;
  description: string;
  keywords: string[];
  /** Text readable in the picture — a sign, a document, a label. Empty when none. */
  visibleText: string;
}

/** The language a description is written in. */
export type DescriptionLanguage = "de" | "en";

const LANGUAGE_NAME: Record<DescriptionLanguage, string> = { de: "German", en: "English" };

/**
 * The instruction sent with every picture.
 *
 * JSON because four fields have to come back apart, and a model asked for prose
 * mixes them. The rules name what the description is for — being found again —
 * so the model describes what a person would search for (the room, the
 * materials, the view) rather than judging the photograph.
 */
export function descriptionSystemPrompt(language: DescriptionLanguage): string {
  const lang = LANGUAGE_NAME[language];
  return [
    "You describe a picture so that its owner can find it again by searching for what it shows.",
    `Answer in ${lang}, with one JSON object and nothing else:`,
    '{"title": string, "description": string, "keywords": string[], "visibleText": string}',
    "Rules:",
    `- title: what the picture shows, at most ${MAX_DESCRIPTION_TITLE} characters, no full stop.`,
    `- description: two to four plain sentences, at most ${MAX_DESCRIPTION_CHARS} characters: the subject, the setting, materials, colours, notable details. No opinions about the photo.`,
    `- keywords: up to ${MAX_KEYWORDS} single nouns or short noun phrases a person would search for.`,
    "- visibleText: text legible in the picture, verbatim, or an empty string.",
    "- Do not name or guess who a person is. Do not read out licence plates, house numbers or personal data; say that they are present instead."
  ].join("\n");
}

export const DESCRIPTION_USER_PROMPT = "Describe this picture.";

/** The first JSON object in a reply, fences and chatter around it ignored. */
function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Text from the model made safe to write into a note body.
 *
 * The answer is data, and a note is not a neutral container: `[[…]]` would
 * become a link, a leading `#` a tag or heading, a `---` line a frontmatter
 * fence, and HTML would render. Each is taken out rather than escaped, because
 * a description has no use for any of them.
 */
export function sanitizeDescriptionText(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/\[\[|\]\]/g, "")
    .replace(/^\s*-{3,}\s*$/gm, "")
    .replace(/^[ \t]*#+[ \t]+/gm, "")
    .replace(/(^|\s)#+(?=\S)/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function boundedText(value: unknown, max: number, singleLine: boolean): string {
  if (typeof value !== "string") return "";
  let text = sanitizeDescriptionText(value);
  if (singleLine) text = text.replace(/\s*\n\s*/g, " ");
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * A model's reply, checked, or null when it cannot vouch for itself.
 *
 * A reply without a title or a description is refused whole: a picture with a
 * half description is worse than one waiting for its next batch, because the
 * half looks finished. Keywords are cleaned one by one, deduplicated without
 * regard to case, and cut to the bound; anything that is not a string is dropped.
 */
export function normalizeImageDescription(raw: string): ImageDescription | null {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  const title = boundedText(obj.title, MAX_DESCRIPTION_TITLE, true).replace(/[.。]+$/, "");
  const description = boundedText(obj.description, MAX_DESCRIPTION_CHARS, false);
  if (!title || !description) return null;

  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const entry of Array.isArray(obj.keywords) ? obj.keywords : []) {
    const keyword = boundedText(entry, MAX_KEYWORD_CHARS, true).replace(/[,;]+/g, " ").trim();
    const key = keyword.toLocaleLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
    if (keywords.length === MAX_KEYWORDS) break;
  }

  return {
    title,
    description,
    keywords,
    visibleText: boundedText(obj.visibleText, MAX_VISIBLE_TEXT_CHARS, false)
  };
}

/**
 * A picture's fingerprint: whether it changed since it was described.
 *
 * Two FNV-1a passes with different offsets, so sixteen hex digits rather than
 * eight — a vault of thousands of pictures makes an eight-digit collision
 * plausible, and a collision here means a changed picture keeps a stale
 * description. Not cryptographic, and it does not need to be.
 */
export function hashImageBytes(bytes: Uint8Array): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    a = Math.imul(a ^ byte, 0x01000193) >>> 0;
    b = Math.imul(b ^ byte, 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** Where description notes go unless the person says otherwise. */
export const DEFAULT_DESCRIPTION_FOLDER = "Bildbeschreibungen";

/**
 * The description folder as a vault path, or the default.
 *
 * `data.json` is edited by hand as well as by the settings tab, and this path is
 * written to: a `..` segment, a leading slash or an empty name must not choose
 * where notes are created. Slashes at either end are dropped and runs of them
 * collapsed; anything with a `.` or `..` segment falls back to the default.
 */
export function normalizeDescriptionFolder(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_DESCRIPTION_FOLDER;
  const segments = value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0 || segments.some((s) => s === "." || s === "..")) {
    return DEFAULT_DESCRIPTION_FOLDER;
  }
  return segments.join("/");
}

/** The frontmatter keys a description note owns. */
export const DESCRIPTION_KEYS = {
  image: "schreibstubeImage",
  hash: "schreibstubeImageHash",
  size: "schreibstubeImageSize",
  describedAt: "schreibstubeDescribedAt",
  keywords: "schreibstubeKeywords"
} as const;

export interface DescribedImage {
  /** The picture's vault path. */
  path: string;
  hash: string;
  size: number;
  /** ISO timestamp of the description. */
  describedAt: string;
}

/**
 * Where a picture's description lives: one shared folder, the picture's name
 * and the first eight digits of its path's hash. The hash keeps two pictures of
 * the same name in different folders apart; the name keeps the file readable.
 * The link in the frontmatter, not this name, is what pairs note and picture.
 */
export function descriptionNotePath(folder: string, imagePath: string): string {
  const name = imagePath.split("/").pop() ?? imagePath;
  const tag = hashImageBytes(new TextEncoder().encode(imagePath)).slice(0, 8);
  const base = folder.replace(/\/+$/, "");
  return `${base ? `${base}/` : ""}${name} – ${tag}.md`;
}

/** A string as a YAML scalar: JSON's double-quoted form is valid YAML. */
function yaml(value: string): string {
  return JSON.stringify(value);
}

/**
 * The description note, whole.
 *
 * The picture is embedded first, so opening the note from any other tool shows
 * what it describes. Keywords appear twice on purpose: in a key Schreibstube
 * reads, and as plain text for tools that read only note bodies. They go into
 * Obsidian's `tags` only when asked, because thousands of pictures with eight
 * keywords each would flood the tag pane.
 */
export function renderDescriptionNote(
  image: DescribedImage,
  desc: ImageDescription,
  opts: { keywordsAsTags?: boolean; language?: DescriptionLanguage } = {}
): string {
  const labels =
    opts.language === "en"
      ? { keywords: "Keywords", visible: "Visible text" }
      : { keywords: "Stichworte", visible: "Sichtbarer Text" };
  const list = (key: string, values: string[]): string[] =>
    values.length === 0 ? [`${key}: []`] : [`${key}:`, ...values.map((v) => `  - ${yaml(v)}`)];

  const frontmatter = [
    "---",
    `${DESCRIPTION_KEYS.image}: ${yaml(`[[${image.path}]]`)}`,
    `${DESCRIPTION_KEYS.hash}: ${yaml(image.hash)}`,
    `${DESCRIPTION_KEYS.size}: ${image.size}`,
    `${DESCRIPTION_KEYS.describedAt}: ${yaml(image.describedAt)}`,
    ...list(DESCRIPTION_KEYS.keywords, desc.keywords),
    ...(opts.keywordsAsTags
      ? list(
          "tags",
          desc.keywords.map((k) => k.replace(/\s+/g, "-"))
        )
      : []),
    `title: ${yaml(desc.title)}`,
    "---"
  ];

  const body = [
    `![[${image.path}]]`,
    "",
    desc.description,
    "",
    `${labels.keywords}: ${desc.keywords.join(", ") || "–"}`,
    "",
    `${labels.visible}: ${desc.visibleText || "–"}`
  ];

  return `${[...frontmatter, "", ...body].join("\n")}\n`;
}
