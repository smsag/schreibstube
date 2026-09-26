import { describe, expect, it } from "vitest";
import {
  buildJob,
  checkFontBudget,
  checkJobLimits,
  checkPdfSize,
  checkPictureBudget,
  COMPILE_BASE_MS,
  COMPILE_MAX_MS,
  compileDeadline,
  isTypesetPdf,
  jobAssetPath,
  MAIN_FILE,
  type JobInput
} from "./print-job";
import { PRELUDE_FILE } from "./print-prelude";
import {
  LAYOUT_FILE,
  MAX_FONT_FILES,
  MAX_IMAGE_FILES,
  MAX_PDF_BYTES,
  parseTemplate
} from "./print-template";

const bytes = (size: number): Uint8Array => new Uint8Array(size);

function input(overrides: Partial<JobInput> = {}): JobInput {
  const { template } = parseTemplate("Vorlagen/Druck/Brief", {
    schreibstubeEntry: "letter",
    schreibstubePage: { size: "a4", margin: "25mm" }
  });
  return {
    template,
    layout: "#let letter(body, data) = body",
    body: "Sehr geehrte Damen und Herren,\n",
    data: { senderName: "Steffen Seitz" },
    fonts: [],
    assets: [],
    ...overrides
  };
}

describe("buildJob", () => {
  it("imports the prelude, then the whole layout, and applies the entry function", () => {
    const job = buildJob(input());
    const prelude = job.main.indexOf('#import "schreibstube.typ": *');
    const layout = job.main.indexOf('#import "template.typ": *');
    // In this order, so a helper the layout defines shadows the prelude's.
    expect(prelude).toBeGreaterThan(-1);
    expect(layout).toBeGreaterThan(prelude);
    expect(job.main).toContain("#show: body => letter(body, data)");
    expect(job.main.endsWith("Sehr geehrte Damen und Herren,\n")).toBe(true);
  });

  it("hands data across as literals, never as source", () => {
    const job = buildJob(input({ data: { subject: 'Betreff "mit" #panic()' } }));
    expect(job.main).toContain('#let data = (subject: "Betreff \\"mit\\" #panic()")');
  });

  it("sets the page the descriptor asked for, before the layout runs", () => {
    expect(buildJob(input()).main).toContain('#set page(paper: "a4", margin: 25mm)');
  });

  it("reads a margin with two, three or four lengths the way CSS does", () => {
    const margin = (value: string): string => {
      const { template } = parseTemplate("t", { schreibstubePage: { margin: value } });
      return buildJob(input({ template })).main;
    };
    expect(margin("25mm 20mm")).toContain("margin: (y: 25mm, x: 20mm)");
    expect(margin("25mm 20mm 30mm")).toContain("margin: (top: 25mm, x: 20mm, bottom: 30mm)");
    expect(margin("1mm 2mm 3mm 4mm")).toContain(
      "margin: (top: 1mm, right: 2mm, bottom: 3mm, left: 4mm)"
    );
  });

  it("says nothing about the page when the descriptor did not", () => {
    const { template } = parseTemplate("t", {});
    expect(buildJob(input({ template })).main).toContain('#set page(paper: "a4")');
  });

  it("carries the layout, the prelude and the pictures as files", () => {
    const job = buildJob(input({ assets: [{ path: "assets/foto.jpg", bytes: bytes(10) }] }));
    expect(job.files.map((file) => file.path)).toEqual([
      LAYOUT_FILE,
      PRELUDE_FILE,
      "assets/foto.jpg"
    ]);
    expect(MAIN_FILE).toBe("main.typ");
  });

  it("hands fonts over separately, because the compiler takes them that way", () => {
    const job = buildJob(input({ fonts: [{ path: "fonts/a.ttf", bytes: bytes(4) }] }));
    expect(job.fonts).toHaveLength(1);
    expect(job.files.some((file) => file.path.startsWith("fonts/"))).toBe(false);
  });
});

describe("checkJobLimits", () => {
  it("passes a job of the size a person actually prints", () => {
    expect(
      checkJobLimits(
        input({
          fonts: [{ path: "fonts/a.ttf", bytes: bytes(300_000) }],
          assets: [{ path: "assets/a.jpg", bytes: bytes(200_000) }]
        })
      )
    ).toEqual([]);
  });

  it("counts font files and says the limit in the same breath", () => {
    const fonts = Array.from({ length: MAX_FONT_FILES + 1 }, (_, i) => ({
      path: `fonts/${i}.ttf`,
      bytes: bytes(10)
    }));
    expect(checkJobLimits(input({ fonts }))[0]).toBe(
      `${MAX_FONT_FILES + 1} font files, at most ${MAX_FONT_FILES} are used`
    );
  });

  it("counts the bytes as well as the files, in megabytes a person reads", () => {
    const fonts = [{ path: "fonts/huge.ttf", bytes: bytes(9 * 1024 * 1024) }];
    expect(checkJobLimits(input({ fonts }))[0]).toBe("fonts total 9 MB, at most 8 MB are used");
  });

  it("holds pictures to their own count and their own total", () => {
    // Counted from the limit rather than written out, so that raising the limit
    // moves the test with it instead of breaking it.
    const over = MAX_IMAGE_FILES + 1;
    const many = Array.from({ length: over }, (_, i) => ({
      path: `assets/${i}.png`,
      bytes: bytes(10)
    }));
    expect(checkJobLimits(input({ assets: many })).join()).toContain(`${over} pictures`);
    expect(checkJobLimits(input({ assets: many.slice(0, MAX_IMAGE_FILES) }))).toEqual([]);

    const heavy = [{ path: "assets/a.png", bytes: bytes(25 * 1024 * 1024) }];
    expect(checkJobLimits(input({ assets: heavy })).join()).toContain("pictures total 25 MB");
  });
});

describe("budgets asked before anything is read", () => {
  it("holds font sizes to the same limits the job is held to", () => {
    expect(checkFontBudget([300_000, 200_000])).toEqual([]);
    expect(checkFontBudget([9 * 1024 * 1024])).toEqual(["fonts total 9 MB, at most 8 MB are used"]);
    expect(checkFontBudget(Array.from({ length: MAX_FONT_FILES + 1 }, () => 1))).toHaveLength(1);
  });

  it("holds picture sizes to theirs", () => {
    expect(checkPictureBudget([1024])).toEqual([]);
    expect(checkPictureBudget([25 * 1024 * 1024]).join()).toContain("pictures total 25 MB");
  });

  it("refuses to write a document over the limit, and names both sizes", () => {
    expect(checkPdfSize(1024)).toBeNull();
    expect(checkPdfSize(MAX_PDF_BYTES)).toBeNull();
    expect(checkPdfSize(31 * 1024 * 1024)).toBe(
      "the document came to 31 MB, at most 30 MB are written"
    );
  });
});

describe("jobAssetPath", () => {
  it("names a picture after its vault path", () => {
    expect(jobAssetPath("Bilder/Foto 1.jpg", new Map())).toBe("assets/Bilder-Foto-1.jpg");
  });

  it("keeps two pictures apart whose names flatten to the same thing", () => {
    const assigned = new Map<string, string>();
    expect(jobAssetPath("a b.png", assigned)).toBe("assets/a-b.png");
    expect(jobAssetPath("a-b.png", assigned)).toBe("assets/a-b-2.png");
    expect(jobAssetPath("a/b.png", assigned)).toBe("assets/a-b-3.png");
  });

  it("gives the same picture the same name every time it is asked for", () => {
    const assigned = new Map<string, string>();
    const first = jobAssetPath("a-b.png", assigned);
    jobAssetPath("a b.png", assigned);
    expect(jobAssetPath("a-b.png", assigned)).toBe(first);
  });

  it("numbers a name without an extension too", () => {
    const assigned = new Map<string, string>();
    jobAssetPath("x y", assigned);
    expect(jobAssetPath("x-y", assigned)).toBe("assets/x-y-2");
  });
});

describe("isTypesetPdf", () => {
  const pdf = (text: string): Uint8Array => new TextEncoder().encode(`%PDF-1.7\n${text}\n%%EOF`);

  it("recognises a document Typst made, by its information or its XMP", () => {
    expect(isTypesetPdf(pdf("<</Creator(Typst 0.14.2)/ModDate(D:2026)>>"))).toBe(true);
    expect(isTypesetPdf(pdf("<xmp:CreatorTool>Typst 0.14.2</xmp:CreatorTool>"))).toBe(true);
  });

  it("takes anything else for somebody's own file", () => {
    expect(isTypesetPdf(pdf("<</Creator(Microsoft Word)/Producer(Typst-ish)>>"))).toBe(false);
    expect(isTypesetPdf(pdf("Typst appears in the text of this scan"))).toBe(false);
    expect(isTypesetPdf(new Uint8Array())).toBe(false);
  });
});

describe("compileDeadline", () => {
  const job = (body: string, pictureBytes = 0, fontBytes = 0) =>
    buildJob(
      input({
        body,
        assets: pictureBytes > 0 ? [{ path: "assets/a.png", bytes: bytes(pictureBytes) }] : [],
        fonts: fontBytes > 0 ? [{ path: "fonts/a.ttf", bytes: bytes(fontBytes) }] : []
      })
    );

  it("gives a letter the base and barely more", () => {
    const deadline = compileDeadline(job("Sehr geehrte Damen und Herren,\n"));
    expect(deadline).toBeGreaterThanOrEqual(COMPILE_BASE_MS);
    expect(deadline).toBeLessThan(COMPILE_BASE_MS + 1_000);
  });

  it("gives a long document the time a slow phone needs for its text", () => {
    // 480 KB set in 1.6 s on a laptop; ten times that is 16 s, and the
    // deadline has to clear it on top of building the compiler.
    const deadline = compileDeadline(job("x".repeat(480 * 1024)));
    expect(deadline).toBeGreaterThan(COMPILE_BASE_MS + 16_000);
    // The old flat 20 s is what failed a long chapter.
    expect(deadline).toBeGreaterThan(20_000 * 2);
  });

  it("counts pictures and fonts as well as text", () => {
    const plain = compileDeadline(job("Text"));
    expect(compileDeadline(job("Text", 10 * 1024 * 1024))).toBeGreaterThan(plain + 2_000);
    expect(compileDeadline(job("Text", 0, 4 * 1024 * 1024))).toBeGreaterThan(plain + 1_000);
  });

  it("never waits longer than the ceiling, however large the note", () => {
    expect(compileDeadline(job("x".repeat(20 * 1024 * 1024)))).toBe(COMPILE_MAX_MS);
  });

  it("grows with the job and never shrinks below the base", () => {
    const sizes = [0, 10, 100, 1000].map((kb) => compileDeadline(job("x".repeat(kb * 1024))));
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(COMPILE_BASE_MS);
  });
});
