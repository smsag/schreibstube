import { describe, it, expect } from "vitest";
import { BodyIndex, BodyLoader, MAX_BODY_TOKENS, MAX_VOCABULARY } from "./body-index";

describe("BodyIndex", () => {
  it("finds a note by a word of its text, a prefix of one, or the head of a compound", () => {
    const index = new BodyIndex();
    index.set("Brief.md", "Die Jahresabrechnung 2024 fehlt noch.");
    index.set("Other.md", "Nichts dergleichen.");
    expect(index.strengths("jahresabrechnung").get("Brief.md")).toBe(1);
    expect(index.strengths("jahres").get("Brief.md")).toBeCloseTo(0.9);
    expect(index.strengths("abrechnung").get("Brief.md")).toBeCloseTo(0.6);
    expect(index.strengths("jahres").has("Other.md")).toBe(false);
  });

  it("does not answer a longer word with a shorter one in the text", () => {
    const index = new BodyIndex();
    index.set("Year.md", "Das Jahr war lang.");
    expect(index.strengths("jahresabrechnung").size).toBe(0);
  });

  it("does not search frontmatter or code, which are not the note's text", () => {
    const index = new BodyIndex();
    index.set("a.md", "---\ntitle: Geheimwort\n---\nText\n```\nfunktionsname\n```");
    expect(index.strengths("geheimwort").size).toBe(0);
    expect(index.strengths("funktionsname").size).toBe(0);
    expect(index.strengths("text").size).toBe(1);
  });

  it("replaces a note's words when it is set again, and forgets on delete", () => {
    const index = new BodyIndex();
    index.set("a.md", "alt");
    index.set("a.md", "neu");
    expect(index.strengths("alt").size).toBe(0);
    expect(index.strengths("neu").size).toBe(1);
    index.delete("a.md");
    expect(index.strengths("neu").size).toBe(0);
    expect(index.has("a.md")).toBe(false);
  });

  it("forgets everything under a folder, and only that", () => {
    const index = new BodyIndex();
    index.set("Akten/a.md", "wort");
    index.set("Akten/Unter/b.md", "wort");
    index.set("Akten-alt/c.md", "wort");
    index.deleteUnder("Akten");
    expect([...index.strengths("wort").keys()]).toEqual(["Akten-alt/c.md"]);
  });

  it("caps the words one note contributes", () => {
    const index = new BodyIndex();
    const words = Array.from({ length: MAX_BODY_TOKENS + 50 }, (_, i) => `w${i}`).join(" ");
    index.set("big.md", words);
    expect(index.vocabularySize).toBe(MAX_BODY_TOKENS);
  });

  it("drops the words of rewritten notes once the vocabulary outgrows its bound", () => {
    const index = new BodyIndex();
    // Each rewrite leaves its words orphaned; enough of them crosses the bound.
    const rounds = Math.ceil(MAX_VOCABULARY / MAX_BODY_TOKENS) + 2;
    for (let r = 0; r < rounds; r++) {
      const words = Array.from({ length: MAX_BODY_TOKENS }, (_, i) => `r${r}w${i}`).join(" ");
      index.set("a.md", words);
    }
    expect(index.vocabularySize).toBeLessThanOrEqual(MAX_VOCABULARY);
    expect(index.strengths(`r${rounds - 1}w7`).get("a.md")).toBe(1);
    expect(index.strengths("r0w7").size).toBe(0);
  });

  it("answers nothing before anything is read, and nothing for an empty word", () => {
    const index = new BodyIndex();
    expect(index.strengths("x").size).toBe(0);
    index.set("a.md", "x");
    expect(index.strengths("").size).toBe(0);
    index.clear();
    expect(index.size).toBe(0);
    expect(index.vocabularySize).toBe(0);
  });
});

describe("BodyLoader", () => {
  const vault = (files: Record<string, string>) => ({
    files,
    reads: [] as string[],
    paths(): string[] {
      return Object.keys(this.files);
    },
    async read(path: string): Promise<string> {
      this.reads.push(path);
      const text = this.files[path];
      if (text === undefined) throw new Error("gone");
      return text;
    }
  });
  const now = () => Promise.resolve();

  it("reads every note once, and only what is missing afterwards", async () => {
    const source = vault({ "a.md": "eins", "b.md": "zwei" });
    const index = new BodyIndex();
    const loader = new BodyLoader(index, source, now);
    expect(await loader.ensure()).toBe(true);
    expect(index.size).toBe(2);
    expect(await loader.ensure()).toBe(false);
    source.files["c.md"] = "drei";
    expect(await loader.ensure()).toBe(true);
    expect(source.reads).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("shares one pass between callers", async () => {
    const source = vault({ "a.md": "eins" });
    const loader = new BodyLoader(new BodyIndex(), source, now);
    await Promise.all([loader.ensure(), loader.ensure()]);
    expect(source.reads).toEqual(["a.md"]);
  });

  it("holds an unreadable note as empty rather than asking on every keystroke", async () => {
    const source = vault({ "a.md": "eins" });
    source.paths = () => ["a.md", "gone.md"];
    const index = new BodyIndex();
    const loader = new BodyLoader(index, source, now);
    await loader.ensure();
    expect(index.has("gone.md")).toBe(true);
    expect(await loader.ensure()).toBe(false);
  });

  it("re-reads one note on refresh, but not one it never read", async () => {
    const source = vault({ "a.md": "alt" });
    const index = new BodyIndex();
    const loader = new BodyLoader(index, source, now);
    await loader.refresh("a.md");
    expect(source.reads).toEqual([]);
    await loader.ensure();
    source.files["a.md"] = "neu";
    await loader.refresh("a.md");
    expect(index.strengths("neu").size).toBe(1);
  });

  it("never lets an older read land over a newer one", async () => {
    let release: (text: string) => void = () => undefined;
    const source = {
      paths: () => ["a.md"],
      calls: 0,
      read(): Promise<string> {
        this.calls++;
        // The first read hangs until released; the refresh answers at once.
        if (this.calls === 1) return new Promise<string>((resolve) => (release = resolve));
        return Promise.resolve("neu");
      }
    };
    const index = new BodyIndex();
    const loader = new BodyLoader(index, source, now);
    const pass = loader.ensure();
    await loader.refresh("a.md");
    release("alt");
    await pass;
    expect(index.strengths("neu").size).toBe(1);
    expect(index.strengths("alt").size).toBe(0);
  });

  it("drops a read still in flight for a note that was forgotten", async () => {
    let release: (text: string) => void = () => undefined;
    const source = {
      paths: () => ["a.md"],
      read: () => new Promise<string>((resolve) => (release = resolve))
    };
    const index = new BodyIndex();
    const loader = new BodyLoader(index, source, now);
    const pass = loader.ensure();
    loader.forget("a.md");
    release("text");
    await pass;
    expect(index.has("a.md")).toBe(false);
  });

  it("yields while it reads a large vault", async () => {
    const files = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`n${i}.md`, "x"]));
    let pauses = 0;
    const loader = new BodyLoader(new BodyIndex(), vault(files), async () => {
      pauses++;
    });
    await loader.ensure();
    expect(pauses).toBeGreaterThan(0);
  });
});

describe("BodyIndex — answers kept between draws", () => {
  it("answers a repeated word from memory, and afresh after the index changed", () => {
    const index = new BodyIndex();
    index.set("a.md", "wort");
    const first = index.strengths("wort");
    expect(index.strengths("wort")).toBe(first);
    index.set("b.md", "wort");
    expect(index.strengths("wort").size).toBe(2);
    index.delete("a.md");
    expect([...index.strengths("wort").keys()]).toEqual(["b.md"]);
  });
});

describe("BodyLoader — a folder going away", () => {
  it("drops reads in flight under a deleted folder", async () => {
    let release: (text: string) => void = () => undefined;
    const source = {
      paths: () => ["Akten/a.md"],
      read: () => new Promise<string>((resolve) => (release = resolve))
    };
    const index = new BodyIndex();
    const loader = new BodyLoader(index, source, () => Promise.resolve());
    const pass = loader.ensure();
    loader.forgetUnder("Akten");
    release("text");
    await pass;
    expect(index.size).toBe(0);
  });
});
