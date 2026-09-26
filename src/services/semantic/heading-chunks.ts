/** A section of a note: the heading above it and its text. */
export interface Chunk {
  heading: string;
  text: string;
  order: number;
}

/** Splits markdown into chunks at each heading line (any level 1–6). */
export function chunkByHeadings(content: string): Chunk[] {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];
  let heading = "";
  let current: string[] = [];

  const flush = (): void => {
    const text = current.join("\n").trim();
    if (text.length > 0) chunks.push({ heading, text, order: chunks.length });
  };

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      flush();
      heading = line.replace(/^#{1,6}\s*/, "").trim();
      current = [line];
    } else {
      current.push(line);
    }
  }
  flush();

  return chunks;
}
