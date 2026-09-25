// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { renderMermaidSvg, svgElementFrom, type MermaidLike } from "./mermaid-render";
import { MERMAID_PRINT_TEXT_LABELS } from "../services/print-mermaid";

const drawing =
  '<svg id="x" viewBox="0 0 10 10"><style>#x .node rect{fill:#ECECFF;}</style><text>Start&nbsp;hier</text></svg>';

function fake(answer: () => Promise<{ svg: string }>) {
  const calls: { id: string; text: string; container?: Element }[] = [];
  const mermaid: MermaidLike = {
    render: (id, text, container) => {
      calls.push({ id, text, ...(container ? { container } : {}) });
      return answer();
    }
  };
  return { mermaid, calls };
}

describe("renderMermaidSvg", () => {
  it("draws the printable text under the id it is given", async () => {
    const { mermaid, calls } = fake(async () => ({ svg: drawing }));
    const svg = await renderMermaidSvg(async () => mermaid, "graph TD\n A-->B", "print-1", 1000);

    expect(svg).toBe(drawing);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe("print-1");
    expect(calls[0]?.text.endsWith(MERMAID_PRINT_TEXT_LABELS)).toBe(true);
  });

  it("passes Mermaid's own complaint on, for the log", async () => {
    const { mermaid } = fake(async () => {
      throw new Error("Parse error on line 2");
    });
    await expect(renderMermaidSvg(async () => mermaid, "graph", "print-2", 1000)).rejects.toThrow(
      "Parse error on line 2"
    );
  });

  it("gives up on a drawing that never comes, instead of holding the print", async () => {
    vi.useFakeTimers();
    const { mermaid } = fake(() => new Promise(() => {}));
    const pending = renderMermaidSvg(async () => mermaid, "graph", "print-3", 5000);
    const settled = expect(pending).rejects.toThrow("mermaid did not draw within 5s");
    await vi.advanceTimersByTimeAsync(5000);
    await settled;
    vi.useRealTimers();
  });

  it("draws inside the stage it is given, so a Gantt chart gets a width", async () => {
    const stage = document.createElement("div");
    const { mermaid, calls } = fake(async () => ({ svg: drawing }));
    await renderMermaidSvg(async () => mermaid, "gantt", "print-6", 1000, stage);
    expect(calls[0]?.container).toBe(stage);
  });

  it("refuses an answer that is not a drawing", async () => {
    const { mermaid } = fake(async () => ({ svg: "" }));
    await expect(renderMermaidSvg(async () => mermaid, "graph", "print-4", 1000)).rejects.toThrow(
      "without a drawing"
    );
  });

  it("takes out what Mermaid left in the document, after success and after an error", async () => {
    for (const answer of [
      async () => ({ svg: drawing }),
      async () => {
        throw new Error("Syntax error");
      }
    ]) {
      for (const id of ["print-5", "dprint-5"]) {
        if (!document.getElementById(id)) {
          const left = document.createElement("div");
          left.id = id;
          document.body.append(left);
        }
      }
      const { mermaid } = fake(answer);
      await renderMermaidSvg(async () => mermaid, "graph", "print-5", 1000).catch(() => {});
      expect(document.getElementById("print-5")).toBeNull();
      expect(document.getElementById("dprint-5")).toBeNull();
    }
  });
});

describe("svgElementFrom", () => {
  // That the stylesheet and the labels arrive intact — umlauts and `&amp;`
  // included — is a browser's HTML parser at work, which the test DOM does not
  // reproduce inside SVG; it was checked in Chromium against Mermaid 11's own
  // output. Here: that the markup becomes an SVG element at all.
  it("reads Mermaid's markup as an SVG element, with its size", () => {
    const svg = svgElementFrom(drawing);
    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 10 10");
  });

  it("refuses markup with no drawing in it", () => {
    expect(() => svgElementFrom("<p>kein Bild</p>")).toThrow("could not be read");
  });
});
