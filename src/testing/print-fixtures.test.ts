import { describe, expect, it } from "vitest";
import { fixtureJobs, PIXEL_PNG, PRINT_CASES } from "./print-fixtures";

// The compile itself runs in CI against the real typesetter; this keeps the
// fixture module building in the fast suite, so a broken fixture is found here.
describe("print fixtures", () => {
  const templates = [
    { folder: "Vorlagen/Druck/Ohne Meinung", frontmatter: {}, layout: "#let template(b, d) = b" }
  ];

  it("builds one job per case and template, named for both", () => {
    const jobs = fixtureJobs(templates);
    expect(jobs).toHaveLength(PRINT_CASES.length);
    expect(new Set(jobs.map((job) => job.name)).size).toBe(jobs.length);
    expect(jobs[0]?.name).toBe(`Ohne Meinung/${PRINT_CASES[0]?.name}`);
  });

  it("supplies every picture a job places", () => {
    for (const { job } of fixtureJobs(templates)) {
      const files = new Set(job.files.map((file) => file.path));
      for (const [, path] of job.main.matchAll(/"(assets\/[^"]+)"/g)) {
        expect(files.has(path ?? "")).toBe(true);
      }
    }
  });

  it("uses a picture Typst can decode: a PNG whose chunks are whole", () => {
    expect([...PIXEL_PNG.slice(1, 4)].map((code) => String.fromCharCode(code)).join("")).toBe(
      "PNG"
    );
  });
});
