/**
 * A Mermaid diagram as printing draws it.
 *
 * Printing used to take the diagram Obsidian had drawn into the note and copy
 * it into a canvas. Mermaid writes most labels — every flowchart's, most class
 * and state diagrams' — as HTML inside `<foreignObject>`, and a browser will
 * not let a canvas that has drawn one be read back: the export failed, and the
 * diagram went to paper as its source. It also carried the app's theme, so a
 * dark vault printed a dark diagram on white paper.
 *
 * So printing asks Mermaid for its own drawing, with two instructions written
 * into the diagram's text as directives, which Mermaid applies to that one
 * render and forgets — Obsidian's own diagrams are untouched:
 *
 * - the light theme, first, so that a theme the note chose itself still wins,
 *   and only when the note chose none: a theme set in the diagram's
 *   frontmatter would otherwise be overridden by a directive after it;
 * - labels as SVG text, last, so that nothing the note says can turn HTML
 *   labels back on and break the export again.
 *
 * Checked against Mermaid 11: directives later in the text win over earlier
 * ones, nothing may stand before a frontmatter block, and a render's
 * directives do not reach the next render.
 */

/** Paper is white: the theme a diagram is printed in unless it chose one. */
export const MERMAID_PRINT_THEME = '%%{init: {"theme": "default", "darkMode": false}}%%';

/** Labels as SVG text rather than HTML, which a canvas can export. */
export const MERMAID_PRINT_TEXT_LABELS =
  '%%{init: {"htmlLabels": false, "flowchart": {"htmlLabels": false}}}%%';

/**
 * The diagram's text as printing renders it: its frontmatter first and
 * untouched, the light theme when the diagram named no theme, the diagram,
 * and the text-label directive last.
 */
export function printableMermaid(source: string): string {
  const text = source.replace(/\r\n?/g, "\n");
  const frontmatter = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(text)?.[0] ?? "";
  const body = text.slice(frontmatter.length).replace(/\n+$/, "");

  const directives = body.split("\n").filter((line) => line.trim().startsWith("%%{"));
  const choseTheme = [frontmatter, ...directives].some((part) =>
    /(^|[\s{,"'])theme["']?\s*:/m.test(part)
  );

  const head = frontmatter === "" || frontmatter.endsWith("\n") ? frontmatter : `${frontmatter}\n`;
  return `${head}${choseTheme ? "" : `${MERMAID_PRINT_THEME}\n`}${body}\n${MERMAID_PRINT_TEXT_LABELS}`;
}

/**
 * An id for one render, unlike any Obsidian or another print uses: Mermaid
 * builds the drawing under this id in the document and refuses a repeat.
 */
export function mermaidRenderId(index: number, stamp: number): string {
  return `schreibstube-print-mermaid-${stamp.toString(36)}-${index}`;
}
