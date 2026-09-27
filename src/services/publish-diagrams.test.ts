import { describe, expect, it } from "vitest";
import {
  diagramAlt,
  diagramAssetName,
  diagramKeyInput,
  DrawnDiagrams,
  findDiagramFences,
  MAX_DIAGRAM_ALT_CHARS,
  MAX_DIAGRAMS_PER_NOTE,
  replaceDiagramFences
} from "./publish-diagrams";

const KEY = "0123456789abcdef0123456789abcdef";

describe("findDiagramFences", () => {
  it("finds a canvas and leaves other fences, mermaid among them, alone", () => {
    const note = [
      "# Plan",
      "```vizardry",
      "type: swot",
      "```",
      "```mermaid",
      "graph TD",
      "```",
      "```ts",
      "const x = 1;",
      "```"
    ].join("\n");

    const fences = findDiagramFences(note);

    expect(fences).toEqual([
      { index: 0, language: "vizardry", source: "type: swot", start: 1, end: 3, lead: "" }
    ]);
  });

  it("does not see a canvas quoted inside another fence", () => {
    const note = ["````markdown", "```vizardry", "type: swot", "```", "````"].join("\n");

    expect(findDiagramFences(note)).toEqual([]);
  });

  it("reads a canvas inside a callout without its quote markers", () => {
    const note = ["> [!note] Plan", "> ```vizardry", "> type: swot", "> block: A", "> ```"].join(
      "\n"
    );

    const [fence] = findDiagramFences(note);

    expect(fence?.source).toBe("type: swot\nblock: A");
    expect(fence?.lead).toBe("> ");
  });

  it("ends a quoted canvas where its quote ends", () => {
    const note = ["> ```vizardry", "> type: swot", "after"].join("\n");

    expect(findDiagramFences(note)[0]).toMatchObject({ start: 0, end: 1 });
  });

  it("keeps a canvas's own indentation when it sits in a list", () => {
    const note = ["- item", "  ```vizardry", "  block: A", "    nested", "  ```"].join("\n");

    const [fence] = findDiagramFences(note);

    expect(fence?.source).toBe("block: A\n  nested");
    expect(fence?.lead).toBe("  ");
  });

  it("takes an unclosed canvas to the end of the note, as Obsidian does", () => {
    expect(findDiagramFences("```vizardry\ntype: swot")[0]).toMatchObject({ end: 1 });
  });

  it("never draws a canvas hidden in a comment", () => {
    const note = [
      "%%",
      "```vizardry",
      "type: swot",
      "```",
      "%%",
      "```vizardry",
      "type: bmc",
      "```"
    ].join("\n");

    const fences = findDiagramFences(note);

    expect(fences.map((fence) => fence.source)).toEqual(["type: bmc"]);
    expect(fences[0]?.index).toBe(0);
  });

  it("stops drawing past the per-note limit", () => {
    const note = Array.from(
      { length: MAX_DIAGRAMS_PER_NOTE + 3 },
      () => "```vizardry\nx\n```"
    ).join("\n");

    expect(findDiagramFences(note)).toHaveLength(MAX_DIAGRAMS_PER_NOTE);
  });
});

describe("diagramKeyInput", () => {
  it("depends on what the canvas says, not where it stands", () => {
    const [a] = findDiagramFences("```vizardry\ntype: swot\n```");
    const [b] = findDiagramFences("intro\n\n> ```vizardry\n> type: swot\n> ```");

    expect(a && b && diagramKeyInput(a)).toBe(b && diagramKeyInput(b));
  });
});

describe("diagramAssetName", () => {
  it("names each panel after the canvas", () => {
    expect(diagramAssetName(KEY, 0)).toBe("schreibstube-diagram-0123456789abcdef-1.png");
    expect(diagramAssetName(KEY, 1)).toBe("schreibstube-diagram-0123456789abcdef-2.png");
  });

  it("refuses a key that is not a digest", () => {
    expect(() => diagramAssetName("../etc", 0)).toThrow();
  });
});

describe("diagramAlt", () => {
  it("keeps the description inside its brackets and on one line", () => {
    expect(diagramAlt("Plan [draft] | 800\nnext", "Diagram")).toBe("Plan (draft) / 800 next");
  });

  it("falls back when the drawing has no title", () => {
    expect(diagramAlt("  \n ", "Diagram")).toBe("Diagram");
  });

  it("is bounded", () => {
    expect(diagramAlt("x".repeat(1000), "Diagram")).toHaveLength(MAX_DIAGRAM_ALT_CHARS);
  });

  it("cannot escape its closing bracket with a backslash", () => {
    expect(diagramAlt("ends in \\", "Diagram")).toBe("ends in /");
  });
});

describe("replaceDiagramFences", () => {
  it("puts each panel where the fence was, as its own paragraph", () => {
    const note = ["# Plan", "```vizardry", "type: swot", "```", "after"].join("\n");
    const fences = findDiagramFences(note);

    const out = replaceDiagramFences(
      note,
      fences,
      new Map([
        [
          0,
          [
            { name: "a-1.png", alt: "SWOT" },
            { name: "a-2.png", alt: "SWOT" }
          ]
        ]
      ])
    );

    expect(out).toBe(["# Plan", "![SWOT](a-1.png)", "", "![SWOT](a-2.png)", "after"].join("\n"));
  });

  it("keeps a canvas in its callout", () => {
    const note = ["> [!note]", "> ```vizardry", "> type: swot", "> ```"].join("\n");

    const out = replaceDiagramFences(
      note,
      findDiagramFences(note),
      new Map([[0, [{ name: "a.png", alt: "SWOT" }]]])
    );

    expect(out).toBe(["> [!note]", "> ![SWOT](a.png)"].join("\n"));
  });

  it("leaves a fence that was not drawn exactly as it was", () => {
    const note = ["```vizardry", "one", "```", "```vizardry", "two", "```"].join("\n");

    const out = replaceDiagramFences(
      note,
      findDiagramFences(note),
      new Map([[1, [{ name: "b.png", alt: "Two" }]]])
    );

    expect(out).toBe(["```vizardry", "one", "```", "![Two](b.png)"].join("\n"));
  });
});

describe("DrawnDiagrams", () => {
  const drawn = (bytes: number) => ({
    alt: "x",
    pictures: [{ name: "a.png", sha256: KEY, bytes: new Uint8Array(bytes) }]
  });

  it("lets the oldest go once the budget is spent", () => {
    const kept = new DrawnDiagrams(100);
    kept.set("a", drawn(40));
    kept.set("b", drawn(40));
    kept.get("a");
    kept.set("c", drawn(40));

    expect(kept.get("b")).toBeUndefined();
    expect(kept.get("a")).toBeDefined();
    expect(kept.get("c")).toBeDefined();
    expect(kept.bytes).toBe(80);
  });

  it("does not keep one drawing larger than the whole budget", () => {
    const kept = new DrawnDiagrams(100);
    kept.set("big", drawn(101));

    expect(kept.get("big")).toBeUndefined();
    expect(kept.bytes).toBe(0);
  });

  it("counts a replaced drawing once", () => {
    const kept = new DrawnDiagrams(100);
    kept.set("a", drawn(30));
    kept.set("a", drawn(50));

    expect(kept.bytes).toBe(50);
  });
});
