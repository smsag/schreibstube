// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { boot, isExpired, LABELS, readPayload } from "./share-unlock.mjs";
import { encryptShare, sharePage, sharePlaintext } from "../share.mjs";

/**
 * The unlock script against the page the bridge writes: the form appears, a
 * wrong password is said, the right one puts the note where the form was.
 */

async function page({ expiresAt = null, body = "<p>Der Text.</p>\n" } = {}) {
  const encrypted = await encryptShare(sharePlaintext({ title: "Angebot", body }), "korrekt-pferd");
  const html = sharePage({ title: "Angebot", body, encrypted, expiresAt });
  // Without what the test browser would go and fetch: the stylesheets and the
  // script itself, which the test runs by hand.
  document.documentElement.innerHTML = html
    .replace(/^<!doctype html>\n<html lang="de">\n/, "")
    .replace(/<link [^>]*>\n/g, "")
    .replace(/<script type="module"[^>]*><\/script>\n/, "");
  return document;
}

async function submit(doc, password) {
  doc.getElementById("share-password").value = password;
  doc.getElementById("share-unlock").dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => {
    expect(doc.getElementById("share-status")?.textContent ?? "").not.toBe(LABELS.opening);
  });
}

describe("isExpired", () => {
  it("reads the page's closing time by the reader's clock", () => {
    expect(isExpired(null)).toBe(false);
    expect(isExpired("bald")).toBe(false);
    expect(isExpired("2026-10-19T12:00:00Z", Date.parse("2026-10-19T12:00:00Z"))).toBe(true);
    expect(isExpired("2026-10-19T12:00:01Z", Date.parse("2026-10-19T12:00:00Z"))).toBe(false);
  });
});

describe("readPayload", () => {
  it("refuses what the bridge did not write", () => {
    expect(readPayload("{")).toBeNull();
    expect(readPayload(JSON.stringify({ v: 2 }))).toBeNull();
    expect(
      readPayload(
        JSON.stringify({ v: 1, kdf: "PBKDF2-SHA256", iterations: 0, salt: "", iv: "", data: "" })
      )
    ).toBeNull();
    expect(
      readPayload(
        JSON.stringify({ v: 1, kdf: "PBKDF2-SHA256", iterations: 1, salt: 1, iv: "", data: "" })
      )
    ).toBeNull();
  });
});

describe("boot", () => {
  it("says a wrong password, and opens the page with the right one", async () => {
    const doc = await page();
    boot(doc, window);
    expect(doc.getElementById("share-unlock").hidden).toBe(false);

    await submit(doc, "falsches-pferd");
    expect(doc.getElementById("share-status").textContent).toBe(LABELS.wrong);
    expect(doc.getElementById("share-content").hidden).toBe(true);

    await submit(doc, "korrekt-pferd");
    const content = doc.getElementById("share-content");
    expect(content.hidden).toBe(false);
    expect(content.innerHTML).toContain("Der Text.");
    expect(doc.getElementById("share-unlock")).toBeNull();
    expect(doc.title).toBe("Angebot");
  }, 20_000);

  it("asks for nothing once the link has run out", async () => {
    const doc = await page({ expiresAt: "2020-01-01T00:00:00.000Z" });
    boot(doc, window);
    expect(doc.getElementById("share-status").textContent).toBe(LABELS.expired);
    expect(doc.getElementById("share-password").disabled).toBe(true);
  });

  it("says so when the payload cannot be read, or the browser cannot decrypt", async () => {
    const doc = await page();
    doc.getElementById("share-payload").textContent = "{";
    boot(doc, window);
    expect(doc.getElementById("share-status").textContent).toBe(LABELS.broken);

    const again = await page();
    boot(again, {});
    expect(again.getElementById("share-status").textContent).toBe(LABELS.unsupported);
  });

  it("leaves a page alone that is not a protected share", () => {
    document.body.innerHTML = "<main><p>Offen.</p></main>";
    expect(() => boot(document, window)).not.toThrow();
  });
});
