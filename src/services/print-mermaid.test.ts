import { describe, expect, it } from "vitest";
import {
  MERMAID_PRINT_TEXT_LABELS,
  MERMAID_PRINT_THEME,
  mermaidRenderId,
  printableMermaid
} from "./print-mermaid";

const flow = "graph TD\n  A[Start] --> B[Ende]";

describe("printableMermaid", () => {
  it("asks for the light theme first and text labels last", () => {
    expect(printableMermaid(flow)).toBe(
      `${MERMAID_PRINT_THEME}\n${flow}\n${MERMAID_PRINT_TEXT_LABELS}`
    );
  });

  it("puts nothing before a frontmatter block, which Mermaid would refuse", () => {
    const source = `---\ntitle: Ablauf\n---\n${flow}`;
    const printed = printableMermaid(source);
    expect(printed.startsWith("---\ntitle: Ablauf\n---\n")).toBe(true);
    expect(printed).toBe(
      `---\ntitle: Ablauf\n---\n${MERMAID_PRINT_THEME}\n${flow}\n${MERMAID_PRINT_TEXT_LABELS}`
    );
  });

  it("leaves a theme the diagram chose in its frontmatter alone", () => {
    // After the frontmatter, the light directive would win over it.
    const printed = printableMermaid(`---\nconfig:\n  theme: forest\n---\n${flow}`);
    expect(printed).not.toContain(MERMAID_PRINT_THEME);
    expect(printed.endsWith(MERMAID_PRINT_TEXT_LABELS)).toBe(true);
  });

  it("leaves a theme the diagram chose in a directive alone", () => {
    const own = '%%{init: {"theme": "forest"}}%%';
    expect(printableMermaid(`${own}\n${flow}`)).toBe(
      `${own}\n${flow}\n${MERMAID_PRINT_TEXT_LABELS}`
    );
    expect(printableMermaid(`%%{init: {'theme':'dark'}}%%\n${flow}`)).not.toContain(
      MERMAID_PRINT_THEME
    );
  });

  it("does not take a node that mentions a theme for a theme setting", () => {
    expect(printableMermaid("graph TD\n  A[theme: dunkel] --> B")).toContain(MERMAID_PRINT_THEME);
  });

  it("always ends with text labels, so the note cannot turn HTML labels back on", () => {
    const own = '%%{init: {"flowchart": {"htmlLabels": true}}}%%';
    const printed = printableMermaid(`${own}\n${flow}`);
    expect(printed.lastIndexOf(MERMAID_PRINT_TEXT_LABELS)).toBeGreaterThan(printed.indexOf(own));
    expect(printed.endsWith(MERMAID_PRINT_TEXT_LABELS)).toBe(true);
  });

  it("reads Windows line ends and trailing blank lines as the editor writes them", () => {
    expect(printableMermaid("graph TD\r\n  A --> B\r\n\r\n")).toBe(
      `${MERMAID_PRINT_THEME}\ngraph TD\n  A --> B\n${MERMAID_PRINT_TEXT_LABELS}`
    );
  });

  it("treats an unclosed frontmatter as diagram text, which Mermaid then reports", () => {
    expect(printableMermaid("---\ntitle: offen\ngraph TD")).toBe(
      `${MERMAID_PRINT_THEME}\n---\ntitle: offen\ngraph TD\n${MERMAID_PRINT_TEXT_LABELS}`
    );
  });
});

describe("mermaidRenderId", () => {
  it("is unlike any other render's, and a valid element id", () => {
    const a = mermaidRenderId(0, 1_790_000_000_000);
    const b = mermaidRenderId(1, 1_790_000_000_000);
    const c = mermaidRenderId(0, 1_790_000_000_001);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(a).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});
