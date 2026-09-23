import { describe, expect, it } from "vitest";
import { collectPassages, joinRuns } from "./pdf-passages";
import type { PdfPageRuns, PdfTextRun } from "./pdf-passages";

const run = (text: string, endsLine = false): PdfTextRun => ({ text, endsLine });
const blank = (): PdfTextRun => ({ text: " ", endsLine: true });

describe("joinRuns", () => {
  it("puts back the space a line break was carrying", () => {
    expect(joinRuns([run("Die Auswertung", true), run("zeigt einen Rückgang")])).toBe(
      "Die Auswertung zeigt einen Rückgang"
    );
  });

  it("closes up a word broken across two lines", () => {
    expect(joinRuns([run("Die Visualisie-", true), run("rung auf Seite 12")])).toBe(
      "Die Visualisierung auf Seite 12"
    );
  });

  it("leaves a real compound hyphen alone", () => {
    expect(joinRuns([run("Mehrwert-", true), run("Steuer ist fällig")])).toBe(
      "Mehrwert- Steuer ist fällig"
    );
  });

  it("does not double a space the run already ends with", () => {
    expect(joinRuns([run("Erstens ", true), run("zweitens")])).toBe("Erstens zweitens");
  });

  it("collapses the whitespace a PDF scatters through a line", () => {
    expect(joinRuns([run("Weit    auseinander"), run("   gesetzt")])).toBe(
      "Weit auseinander gesetzt"
    );
  });
});

describe("collectPassages", () => {
  const page = (n: number, runs: PdfTextRun[]): PdfPageRuns => ({ page: n, runs });

  it("cuts a page into passages at its blank runs", () => {
    const passages = collectPassages([
      page(12, [
        run("Die Auswertung zeigt einen deutlichen Rückgang.", true),
        blank(),
        run("Die Visualisierung auf der folgenden Seite belegt das.", true)
      ])
    ]);

    expect(passages).toHaveLength(2);
    expect(passages[0]?.text).toBe("Die Auswertung zeigt einen deutlichen Rückgang.");
    expect(passages[1]?.text).toBe("Die Visualisierung auf der folgenden Seite belegt das.");
  });

  it("anchors each passage to the runs it was built from", () => {
    const passages = collectPassages([
      page(12, [
        blank(),
        run("Ein Satz, der lang genug ist, um zu zählen.", true),
        run("Und seine Fortsetzung auf der nächsten Zeile.", true)
      ])
    ]);

    expect(passages[0]?.anchor).toEqual({
      page: 12,
      selection: { beginIndex: 1, beginOffset: 0, endIndex: 2, endOffset: 45 }
    });
  });

  it("keeps the page number on every passage it finds there", () => {
    const passages = collectPassages([
      page(3, [run("Ein hinreichend langer Satz auf Seite drei.", true)]),
      page(4, [run("Ein hinreichend langer Satz auf Seite vier.", true)])
    ]);

    expect(passages.map((p) => p.page)).toEqual([3, 4]);
    expect(passages.map((p) => p.anchor.page)).toEqual([3, 4]);
  });

  it("drops running heads and folios below the floor", () => {
    const passages = collectPassages([
      page(12, [
        run("12", true),
        blank(),
        run("Ein Satz, der die Untergrenze deutlich überschreitet.", true)
      ])
    ]);

    expect(passages).toHaveLength(1);
    expect(passages[0]?.text).toContain("Untergrenze");
  });

  it("honours a floor the caller sets", () => {
    const runs = [run("Kurz.", true)];
    expect(collectPassages([page(1, runs)], { minCharacters: 3 })).toHaveLength(1);
    expect(collectPassages([page(1, runs)], { minCharacters: 80 })).toHaveLength(0);
  });

  it("comes back empty for a page with no text layer, rather than with noise", () => {
    expect(collectPassages([page(1, [])])).toEqual([]);
    expect(collectPassages([page(1, [blank(), blank()])])).toEqual([]);
  });

  it("closes the last passage even when the page does not end blank", () => {
    const passages = collectPassages([
      page(1, [run("Ein Satz ohne abschließende Leerzeile am Seitenende.")])
    ]);

    expect(passages).toHaveLength(1);
    expect(passages[0]?.anchor.selection?.endIndex).toBe(0);
  });
});
