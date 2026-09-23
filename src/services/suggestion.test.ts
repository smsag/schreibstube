import { describe, expect, it } from "vitest";
import {
  applyPlan,
  createSuggestion,
  mergeSuggestions,
  planApply,
  refreshStaleness,
  resolveAnchor,
  revealRange,
  settleStatuses,
  INSERT_REVEAL_CHARS,
  type Suggestion
} from "./suggestion";

function at(text: string, original: string, replacement: string): Suggestion {
  const from = text.indexOf(original);
  return createSuggestion({
    kind: "replace",
    source: "glossary",
    category: "terminology",
    severity: "warning",
    from,
    to: from + original.length,
    original,
    replacement,
    note: ""
  });
}

describe("resolveAnchor", () => {
  const text = "Die Immobilie ist frei und die Wohnung auch.";

  it("uses the recorded offsets when the text is unchanged", () => {
    const suggestion = at(text, "Immobilie", "Objekt");
    expect(resolveAnchor(text, suggestion)).toEqual({ from: 4, to: 13 });
  });

  it("follows the text when earlier content shifted it", () => {
    const suggestion = at(text, "Immobilie", "Objekt");
    const edited = `Vorbemerkung. ${text}`;
    const anchor = resolveAnchor(edited, suggestion);
    expect(edited.slice(anchor!.from, anchor!.to)).toBe("Immobilie");
  });

  it("finds a unique occurrence anywhere in a heavily edited note", () => {
    const suggestion = at(text, "Immobilie", "Objekt");
    const edited = `${"Fülltext. ".repeat(200)}${text}`;
    const anchor = resolveAnchor(edited, suggestion);
    expect(edited.slice(anchor!.from, anchor!.to)).toBe("Immobilie");
  });

  it("returns null when the original text is gone", () => {
    const suggestion = at(text, "Immobilie", "Objekt");
    expect(resolveAnchor("Ganz anderer Text.", suggestion)).toBe(null);
  });

  it("returns null when a distant match is ambiguous", () => {
    const suggestion = at(text, "Immobilie", "Objekt");
    const edited = `${"Fülltext. ".repeat(200)}Immobilie hier und Immobilie dort.`;
    expect(resolveAnchor(edited, suggestion)).toBe(null);
  });

  it("picks the nearest of several occurrences close by", () => {
    const source = "Immobilie eins. Immobilie zwei.";
    const suggestion = at(source, "Immobilie", "Objekt");
    suggestion.from = 16;
    suggestion.to = 25;
    const edited = `X${source}`;
    expect(resolveAnchor(edited, suggestion)).toEqual({ from: 17, to: 26 });
  });

  it("places a pure insertion by the text recorded before it", () => {
    const source = "abc def";
    const suggestion = createSuggestion(
      {
        kind: "insert",
        source: "llm",
        category: "punctuation",
        severity: "suggestion",
        from: 3,
        to: 3,
        original: "",
        replacement: ",",
        note: ""
      },
      source.slice(0, 3)
    );

    expect(resolveAnchor(source, suggestion)).toEqual({ from: 3, to: 3 });
    // The words it follows moved along, so the point moves with them rather
    // than staying at an offset that is now somebody else's line.
    expect(resolveAnchor(`XX${source}`, suggestion)).toEqual({ from: 5, to: 5 });
    // A document that no longer holds those words cannot place it at all.
    expect(resolveAnchor("xxxxxxxxxxxx", suggestion)).toBeNull();
  });

  it("places a pure insertion recorded at the very start of the document", () => {
    // Offset zero is the one anchor no edit can move out from under, so this
    // one needs nothing remembered before it.
    const suggestion = createSuggestion({
      kind: "insert",
      source: "llm",
      category: "punctuation",
      severity: "suggestion",
      from: 0,
      to: 0,
      original: "",
      replacement: "Das ",
      note: ""
    });

    expect(resolveAnchor("Haus ist schön.", suggestion)).toEqual({ from: 0, to: 0 });
    expect(resolveAnchor("ganz etwas anderes", suggestion)).toEqual({ from: 0, to: 0 });
  });

  it("refuses a pure insertion recorded with nothing before it", () => {
    const suggestion = createSuggestion({
      kind: "insert",
      source: "llm",
      category: "punctuation",
      severity: "suggestion",
      from: 3,
      to: 3,
      original: "",
      replacement: ",",
      note: ""
    });

    expect(resolveAnchor("abc def", suggestion)).toBeNull();
  });

  it("carries an insertion along when the edit is above what it was recorded behind", () => {
    const head =
      "Ein erster Absatz, lang genug, dass eine Änderung an seinem Anfang " +
      "außerhalb des gemerkten Kontexts liegt.\n\n";
    const note = `${head}Zweite Zeile\nDritte Zeile\n`;
    const at = note.indexOf("Dritte");
    const insertion = createSuggestion(
      {
        kind: "insert",
        source: "remote",
        category: "update",
        severity: "suggestion",
        from: at,
        to: at,
        original: "",
        replacement: "Neue Zeile\n",
        note: ""
      },
      note.slice(0, at)
    );

    const edited = note.replace("Ein erster", "Ein ganz erheblich veränderter erster");
    const moved = resolveAnchor(edited, insertion);

    expect(moved?.from).not.toBe(at);
    expect(edited.slice(moved?.from ?? 0)).toBe("Dritte Zeile\n");
  });

  it("goes stale rather than landing mid-line when what it followed is gone", () => {
    // The shape that made this worth fixing: a source gained a block, an
    // earlier card was accepted, and the offsets moved under the insertion.
    // Refusing it costs a re-run; placing it on the old offset costs the note.
    const note = "Erste Zeile\nZweite Zeile\nDritte Zeile\n";
    const at = note.indexOf("Dritte");
    const insertion = createSuggestion(
      {
        kind: "insert",
        source: "remote",
        category: "update",
        severity: "suggestion",
        from: at,
        to: at,
        original: "",
        replacement: "Neue Zeile\n",
        note: ""
      },
      note.slice(0, at)
    );

    expect(resolveAnchor(note.replace("Zweite Zeile\n", ""), insertion)).toBeNull();
  });
});

describe("planApply", () => {
  const text = "Die Immobilie und der Broker sind da.";

  it("orders changes last-first so offsets stay valid", () => {
    const plan = planApply(text, [at(text, "Immobilie", "Objekt"), at(text, "Broker", "Makler")]);
    expect(plan.changes.map((c) => c.text)).toEqual(["Makler", "Objekt"]);
  });

  it("applies a batch correctly", () => {
    const plan = planApply(text, [at(text, "Immobilie", "Objekt"), at(text, "Broker", "Makler")]);
    expect(applyPlan(text, plan)).toBe("Die Objekt und der Makler sind da.");
  });

  it("applies a single change correctly", () => {
    const plan = planApply(text, [at(text, "Broker", "Makler")]);
    expect(applyPlan(text, plan)).toBe("Die Immobilie und der Makler sind da.");
  });

  it("reports a suggestion that can no longer be placed", () => {
    const gone = at(text, "Broker", "Makler");
    const plan = planApply("Ganz anderer Text.", [gone]);
    expect(plan.stale).toEqual([gone.id]);
    expect(plan.changes).toEqual([]);
  });

  it("drops the second of two overlapping changes", () => {
    const first = at(text, "Die Immobilie", "Das Objekt");
    const second = at(text, "Immobilie", "Liegenschaft");
    const plan = planApply(text, [first, second]);
    expect(plan.changes).toHaveLength(1);
    expect(plan.conflicted).toEqual([second.id]);
  });

  it("survives a note edited between scan and accept", () => {
    const edited = `Neue Zeile.\n\n${text}`;
    const plan = planApply(edited, [at(text, "Immobilie", "Objekt"), at(text, "Broker", "Makler")]);
    expect(applyPlan(edited, plan)).toBe("Neue Zeile.\n\nDie Objekt und der Makler sind da.");
  });
});

describe("settleStatuses", () => {
  const text = "Die Immobilie und der Broker.";

  it("marks applied suggestions accepted and conflicts stale", () => {
    const first = at(text, "Die Immobilie", "Das Objekt");
    const second = at(text, "Immobilie", "Liegenschaft");
    const plan = planApply(text, [first, second]);
    const settled = settleStatuses([first, second], plan, new Set([first.id]));
    expect(settled[0]?.status).toBe("accepted");
    expect(settled[1]?.status).toBe("stale");
  });

  it("leaves untouched suggestions alone", () => {
    const first = at(text, "Immobilie", "Objekt");
    const other = at(text, "Broker", "Makler");
    const plan = planApply(text, [first]);
    const settled = settleStatuses([first, other], plan, new Set(["a"]));
    expect(settled[1]?.status).toBe("pending");
  });
});

describe("refreshStaleness", () => {
  const text = "Die Immobilie ist frei.";

  it("marks a suggestion stale once its text is gone", () => {
    const suggestion = at(text, "Immobilie", "Objekt");
    const [refreshed] = refreshStaleness("Alles anders.", [suggestion]);
    expect(refreshed?.status).toBe("stale");
  });

  it("revives a stale suggestion when the text comes back", () => {
    const suggestion = { ...at(text, "Immobilie", "Objekt"), status: "stale" as const };
    const [refreshed] = refreshStaleness(text, [suggestion]);
    expect(refreshed?.status).toBe("pending");
  });

  it("never reopens an accepted suggestion", () => {
    const suggestion = { ...at(text, "Immobilie", "Objekt"), status: "accepted" as const };
    expect(refreshStaleness("Alles anders.", [suggestion])[0]?.status).toBe("accepted");
  });

  it("never reopens a rejected suggestion", () => {
    const suggestion = { ...at(text, "Immobilie", "Objekt"), status: "rejected" as const };
    expect(refreshStaleness(text, [suggestion])[0]?.status).toBe("rejected");
  });
});

describe("mergeSuggestions", () => {
  const text = "Die Immobilie und der Broker.";

  it("adds new suggestions in document order", () => {
    const merged = mergeSuggestions(
      [at(text, "Broker", "Makler")],
      [at(text, "Immobilie", "Objekt")]
    );
    expect(merged.map((s) => s.original)).toEqual(["Immobilie", "Broker"]);
  });

  it("does not duplicate a suggestion found by a second scan", () => {
    const first = at(text, "Immobilie", "Objekt");
    const again = at(text, "Immobilie", "Objekt");
    expect(mergeSuggestions([first], [again])).toHaveLength(1);
  });

  it("keeps a rejection when the same span is found again", () => {
    const rejected = { ...at(text, "Immobilie", "Objekt"), status: "rejected" as const };
    const merged = mergeSuggestions([rejected], [at(text, "Immobilie", "Objekt")]);
    expect(merged[0]?.status).toBe("rejected");
  });

  it("keeps an acceptance when the same span is found again", () => {
    const accepted = { ...at(text, "Immobilie", "Objekt"), status: "accepted" as const };
    const merged = mergeSuggestions([accepted], [at(text, "Immobilie", "Objekt")]);
    expect(merged[0]?.status).toBe("accepted");
  });

  it("treats a different replacement for the same span as a new suggestion", () => {
    const rejected = { ...at(text, "Immobilie", "Objekt"), status: "rejected" as const };
    const merged = mergeSuggestions([rejected], [at(text, "Immobilie", "Liegenschaft")]);
    expect(merged).toHaveLength(2);
  });

  it("returns the incoming scan when the queue is empty", () => {
    expect(mergeSuggestions([], [at(text, "Broker", "Makler")])).toHaveLength(1);
  });
});

describe("mergeSuggestions with a replaced source", () => {
  const text = "Die Immobilie und der Broker.";

  function llm(original: string, replacement: string): Suggestion {
    return { ...at(text, original, replacement), source: "llm" };
  }

  it("drops the previous run's undecided cards", () => {
    const merged = mergeSuggestions([llm("Broker", "Makler")], [], "llm");
    expect(merged).toEqual([]);
  });

  it("keeps decided cards from the previous run", () => {
    const rejected = { ...llm("Broker", "Makler"), status: "rejected" as const };
    expect(mergeSuggestions([rejected], [], "llm")).toHaveLength(1);
  });

  it("leaves cards from the other source alone", () => {
    const glossaryCard = at(text, "Immobilie", "Objekt");
    const merged = mergeSuggestions([glossaryCard], [llm("Broker", "Makler")], "llm");
    expect(merged.map((s) => s.source)).toEqual(["glossary", "llm"]);
  });

  it("never leaves two cards answering to one id", () => {
    // A decided card from an earlier scan sits alongside a new one for a
    // different span. Accept and Reject reach a card by id, so a shared id
    // would send the click to whichever of the two comes first.
    const accepted = { ...llm("Broker", "Makler"), status: "accepted" as const };
    const merged = mergeSuggestions([accepted], [llm("Immobilie", "Objekt")], "llm");
    expect(merged).toHaveLength(2);
    expect(new Set(merged.map((s) => s.id)).size).toBe(2);
  });

  it("replaces rather than duplicates on a re-scan", () => {
    const first = mergeSuggestions([], [llm("Broker", "Makler")], "llm");
    const second = mergeSuggestions(first, [llm("Broker", "Makler")], "llm");
    expect(second).toHaveLength(1);
  });
});

describe("revealRange", () => {
  // The context an insertion anchors by comes from the text before it, as the
  // factory reads it; the test hands over the same text a scan would have.
  const insertion = (text: string, at: number): Suggestion =>
    createSuggestion(
      {
        kind: "insert",
        source: "remote",
        category: "update",
        severity: "suggestion",
        from: at,
        to: at,
        original: "",
        replacement: "neuer Satz",
        note: ""
      },
      text.slice(0, at)
    );

  it("selects a card's own text when it has some", () => {
    const text = "Der Bericht ist fertig.";
    const card = at(text, "fertig", "abgeschlossen");

    expect(revealRange(text, { from: 16, to: 22 }, card)).toEqual({ from: 16, to: 22 });
  });

  it("selects the last words before an insertion point, so the landing is visible", () => {
    const text = "Die Auswertung zeigt einen Rückgang. Weiter geht es unten.";
    const point = text.indexOf(" Weiter");

    const range = revealRange(text, { from: point, to: point }, insertion(text, point));

    expect(text.slice(range.from, range.to)).toBe("zeigt einen Rückgang.");
    expect(range.to).toBe(point);
  });

  it("never starts a selection mid-word", () => {
    const text = "abcdefghijklmnopqrstuvwxyz Ende";
    const point = text.length;

    const range = revealRange(text, { from: point, to: point }, insertion(text, point));

    expect(text.slice(range.from)).toBe("Ende");
  });

  it("takes a word longer than the window as it is, rather than nothing", () => {
    const word = "Donaudampfschifffahrtsgesellschaftskapitän";
    const point = word.length;

    const range = revealRange(word, { from: point, to: point }, insertion(word, point));

    expect(range.from).toBe(word.length - INSERT_REVEAL_CHARS);
  });

  it("starts at the beginning of a document that has nothing before the point", () => {
    const text = "Kurz.";

    expect(revealRange(text, { from: 0, to: 0 }, insertion(text, 0))).toEqual({ from: 0, to: 0 });
  });
});
