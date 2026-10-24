import { describe, expect, it } from "vitest";
import { HTML_TEXT_RATIO, htmlToText } from "./mail-text.mjs";

describe("htmlToText", () => {
  it("reads only a few times the text limit of a huge HTML body", () => {
    const limit = 10;
    const html = `<p>${"a".repeat(5)}</p>${"<b></b>".repeat(20)}<p>zzz</p>`;
    const text = htmlToText(html, limit);
    expect(text).toBe("aaaaa");
    expect(html.length).toBeGreaterThan(HTML_TEXT_RATIO * limit);
    expect(htmlToText("<p>Hallo</p><p>Welt</p>", 40_000)).toBe("Hallo\nWelt");
  });

  it("reads an escaped entity as the entity it spells, not as the character", () => {
    expect(htmlToText("<p>&amp;lt;b&amp;gt; heißt fett</p>", 40_000)).toBe("&lt;b&gt; heißt fett");
    expect(htmlToText("Tom &amp; Jerry &quot;&#39;&nbsp;&lt;3", 40_000)).toBe(`Tom & Jerry "' <3`);
  });

  it("leaves out scripts and styles with what they hold, whatever their case", () => {
    const html =
      "<STYLE>p { color: red }</style><p>Hallo</p><script type=x>alert(1)</SCRIPT>" +
      "<style>a{}</style><p>Welt</p>";
    expect(htmlToText(html, 40_000)).toBe("Hallo\nWelt");
  });

  it("keeps the text after a script that never closes, losing only its tag", () => {
    expect(htmlToText("<p>Hallo</p><script>Welt", 40_000)).toBe("Hallo\nWelt");
    expect(htmlToText("<script>a<style>b</style>c", 40_000)).toBe("ac");
  });

  it("treats a bracket with nothing in it, or no partner, as text", () => {
    expect(htmlToText("a <> b", 40_000)).toBe("a <> b");
    expect(htmlToText("<b>fett</b> und 3 < 4", 40_000)).toBe("fett und 3 < 4");
  });

  it("reads a mail of brackets that never close in linear time", () => {
    // Each of these took seconds when every `<` scanned to the end of the text.
    const maxTextChars = 40_000;
    const started = performance.now();
    htmlToText("<a".repeat(HTML_TEXT_RATIO * maxTextChars), maxTextChars);
    htmlToText("<script".repeat(HTML_TEXT_RATIO * maxTextChars), maxTextChars);
    htmlToText(`${"<style>x</style><script".repeat(10_000)}`, maxTextChars);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
