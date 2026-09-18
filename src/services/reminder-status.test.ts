import { describe, expect, it } from "vitest";
import {
  applyDone,
  idsInReport,
  isStatusCallback,
  reportFromParams,
  sentTaskIds,
  statusCallbackUrl,
  statusShortcutUrl
} from "./reminder-status";

const link = (id: string) => `[⏰](obsidian://schreibstube?task=${id})`;

describe("sentTaskIds", () => {
  it("lists the ids of sent tasks in order, once each", () => {
    const content = [
      "# H",
      `- [ ] a ${link("aaaaaa")}`,
      "- [ ] not sent",
      `- [x] b ${link("bbbbbb")}`,
      `- [ ] a again ${link("aaaaaa")}`
    ].join("\n");
    expect(sentTaskIds(content)).toEqual(["aaaaaa", "bbbbbb"]);
    expect(sentTaskIds("- [ ] nothing")).toEqual([]);
  });
});

describe("idsInReport", () => {
  it("pulls every task id out of whatever text the Shortcut returned", () => {
    const report = [
      "Ask about the fee",
      "",
      "↩ Klartext Backlog",
      "obsidian://schreibstube?task=aaaaaa",
      "some other note obsidian://schreibstube?task=bbbbbb and obsidian://schreibstube?task=aaaaaa"
    ].join("\n");
    expect(idsInReport(report)).toEqual(["aaaaaa", "bbbbbb"]);
  });

  it("finds nothing in text without links", () => {
    expect(idsInReport("")).toEqual([]);
    expect(idsInReport("no links here")).toEqual([]);
    expect(idsInReport("obsidian://schreibstube?task=")).toEqual([]);
  });
});

describe("applyDone", () => {
  it("ticks the open tasks whose ids are reported and leaves the rest", () => {
    const content = [
      `- [ ] one ${link("aaaaaa")}`,
      `  * [ ] two ${link("bbbbbb")}`,
      `- [ ] three ${link("cccccc")}`,
      "- [ ] plain"
    ].join("\n");

    const result = applyDone(content, ["aaaaaa", "bbbbbb", "zzzzzz"]);

    expect(result.ticked).toEqual(["aaaaaa", "bbbbbb"]);
    expect(result.content.split("\n")).toEqual([
      `- [x] one ${link("aaaaaa")}`,
      `  * [x] two ${link("bbbbbb")}`,
      `- [ ] three ${link("cccccc")}`,
      "- [ ] plain"
    ]);
  });

  it("does not touch a task that is already done, whatever its marker", () => {
    const content = [`- [x] a ${link("aaaaaa")}`, `- [-] b ${link("bbbbbb")}`].join("\n");
    const result = applyDone(content, ["aaaaaa", "bbbbbb"]);
    expect(result.ticked).toEqual([]);
    expect(result.content).toBe(content);
  });

  it("returns the content untouched when nothing is reported", () => {
    const content = `- [ ] a ${link("aaaaaa")}`;
    expect(applyDone(content, [])).toEqual({ content, ticked: [] });
  });

  it("keeps CRLF line endings", () => {
    const content = `- [ ] a ${link("aaaaaa")}\r\n- [ ] b`;
    expect(applyDone(content, ["aaaaaa"]).content).toBe(`- [x] a ${link("aaaaaa")}\r\n- [ ] b`);
  });
});

describe("the status Shortcut and its callback", () => {
  it("runs the Shortcut through x-callback-url with the ids and a way back", () => {
    const url = statusShortcutUrl(" Schreibstube Reminder Status ", {
      ids: ["aaaaaa", "bbbbbb"],
      list: "Arbeit"
    });
    expect(
      url.startsWith(
        "shortcuts://x-callback-url/run-shortcut?name=Schreibstube%20Reminder%20Status&input=text&text="
      )
    ).toBe(true);
    const params = new URL(url.replace("shortcuts://", "https://x/")).searchParams;
    expect(JSON.parse(params.get("text") ?? "")).toEqual({
      ids: ["aaaaaa", "bbbbbb"],
      links: ["obsidian://schreibstube?task=aaaaaa", "obsidian://schreibstube?task=bbbbbb"],
      list: "Arbeit"
    });
    expect(params.get("x-success")).toBe("obsidian://schreibstube?done=1");
  });

  it("recognises the callback and reads the report from it", () => {
    expect(statusCallbackUrl()).toBe("obsidian://schreibstube?done=1");
    expect(isStatusCallback({ done: "1", result: "x" })).toBe(true);
    expect(isStatusCallback({ task: "aaaaaa" })).toBe(false);
    expect(reportFromParams({ done: "1", result: "the notes" })).toBe("the notes");
    expect(reportFromParams({ done: "1" })).toBe("");
  });
});
