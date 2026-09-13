import { describe, expect, it } from "vitest";
import { buildJob, checkJobLimits, MAIN_FILE, type JobInput } from "./print-job";
import { PRELUDE_FILE } from "./print-prelude";
import { LAYOUT_FILE, MAX_FONT_FILES, parseTemplate } from "./print-template";

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
  it("imports the layout and the prelude, and applies the entry function", () => {
    const job = buildJob(input());
    expect(job.main).toContain('#import "template.typ": letter');
    expect(job.main).toContain('#import "schreibstube.typ": *');
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
    const many = Array.from({ length: 41 }, (_, i) => ({
      path: `assets/${i}.png`,
      bytes: bytes(10)
    }));
    expect(checkJobLimits(input({ assets: many })).join()).toContain("41 pictures");

    const heavy = [{ path: "assets/a.png", bytes: bytes(25 * 1024 * 1024) }];
    expect(checkJobLimits(input({ assets: heavy })).join()).toContain("pictures total 25 MB");
  });
});
