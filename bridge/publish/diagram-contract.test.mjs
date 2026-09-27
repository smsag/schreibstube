import { describe, expect, it } from "vitest";
import { buildSite, sha256 } from "./site.mjs";
import { assetPath } from "./path.mjs";
import {
  diagramAlt,
  diagramAssetName,
  findDiagramFences,
  replaceDiagramFences
} from "../../src/services/publish-diagrams.ts";

/**
 * The plugin rewrites a canvas fence into a picture before the note is
 * uploaded, so that this bridge — any version of it — needs to know nothing
 * about canvases. This holds the two sides to that: what the plugin writes is
 * what the renderer turns into the uploaded picture.
 */
describe("a drawn canvas, on the bridge", () => {
  it("renders as the uploaded picture, described by the canvas's title", async () => {
    const note = ["# Plan", "", "> [!note]", "> ```vizardry", "> type: swot", "> ```"].join("\n");
    const name = diagramAssetName("ab".repeat(32), 0);
    const pictureHash = "cd".repeat(32);
    const rewritten = replaceDiagramFences(
      note,
      findDiagramFences(note),
      new Map([[0, [{ name, alt: diagramAlt("SWOT [Q3]", "Diagram") }]]])
    );

    const sourceHash = sha256(rewritten);
    const index = {
      siteTitle: "Site",
      notes: [
        {
          sourcePath: "Blog/Plan.md",
          sha256: sourceHash,
          slug: "plan",
          title: "Plan",
          date: "2026-09-27"
        }
      ],
      assets: [{ sourcePath: name, sha256: pictureHash, name, bytes: 10 }]
    };

    const files = await buildSite(index, new Map([[sourceHash, rewritten]]));
    const page = files.get("plan/index.html")?.toString("utf8") ?? "";

    expect(page).toContain(`src="../${assetPath(pictureHash, name)}"`);
    expect(page).toContain('alt="SWOT (Q3)"');
    expect(page).not.toContain("type: swot");
  });
});
