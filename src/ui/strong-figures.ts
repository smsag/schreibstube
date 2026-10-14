/**
 * A line of a ribbon: the numbers are what the eye is after; the words around
 * them are the same every time. Splitting on digits keeps the sentence
 * translatable as one string and still sets the counts in bold.
 */
export function appendWithStrongFigures(el: HTMLElement, text: string): void {
  for (const part of text.split(/(\d+)/)) {
    if (part === "") continue;
    if (/^\d+$/.test(part)) el.createEl("strong", { text: part });
    else el.appendText(part);
  }
}
