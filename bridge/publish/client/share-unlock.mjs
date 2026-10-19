/**
 * A protected share, in the reader's browser: asks for the password, derives
 * the key the bridge derived, and shows the page if the ciphertext opens.
 *
 * Served beside the page as `unlock.js`, one module with no imports. The
 * decisions are the functions at the top, tested against the bridge's own
 * encryption; the rest wires them to the page. Nothing leaves the browser:
 * the password is never sent anywhere, and a wrong one is known by the
 * cipher's tag, not by asking a server.
 */

export const LABELS = {
  opening: "Wird geöffnet …",
  wrong: "Das Passwort stimmt nicht.",
  expired: "Dieser Link ist abgelaufen.",
  unsupported: "Dieser Browser kann das Dokument nicht öffnen.",
  broken: "Das Dokument ist beschädigt."
};

/** Beside this script on the host; a name, so nothing resolves it ahead of the browser. */
const SLIDESHOW_SCRIPT = "./slideshow.js";

export class WrongPasswordError extends Error {}

export function decodeBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Whether the page's own closing time has passed, by the reader's clock. */
export function isExpired(expiresAt, now = Date.now()) {
  if (!expiresAt) return false;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at <= now;
}

/** The payload as the bridge wrote it, or null when it is not one this script reads. */
export function readPayload(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  const fields = ["salt", "iv", "data"];
  if (payload?.v !== 1 || payload.kdf !== "PBKDF2-SHA256") return null;
  if (!Number.isInteger(payload.iterations) || payload.iterations < 1) return null;
  if (fields.some((field) => typeof payload[field] !== "string")) return null;
  return payload;
}

/** The page's title and body, or a WrongPasswordError. */
export async function decryptPayload(payload, password, subtle = globalThis.crypto.subtle) {
  const material = await subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFC")),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: decodeBase64(payload.salt),
      iterations: payload.iterations
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  let plain;
  try {
    plain = await subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64(payload.iv) },
      key,
      decodeBase64(payload.data)
    );
  } catch {
    throw new WrongPasswordError();
  }
  const opened = JSON.parse(new TextDecoder().decode(plain));
  return { title: String(opened.title ?? ""), html: String(opened.html ?? "") };
}

export function boot(doc, win = doc.defaultView) {
  const form = doc.getElementById("share-unlock");
  const input = doc.getElementById("share-password");
  const status = doc.getElementById("share-status");
  const content = doc.getElementById("share-content");
  const source = doc.getElementById("share-payload");
  if (!form || !input || !status || !content || !source) return;

  const say = (text) => {
    status.textContent = text;
  };
  const expires = doc.querySelector('meta[name="schreibstube-expires"]')?.getAttribute("content");
  form.hidden = false;
  if (isExpired(expires)) {
    form.querySelectorAll("input, button").forEach((element) => (element.disabled = true));
    return say(LABELS.expired);
  }
  const payload = readPayload(source.textContent ?? "");
  if (!payload) return say(LABELS.broken);
  if (!win?.crypto?.subtle) return say(LABELS.unsupported);

  let busy = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    say(LABELS.opening);
    try {
      const opened = await decryptPayload(payload, input.value, win.crypto.subtle);
      // The bridge rendered this markup, as it renders every published page;
      // inserted, a script in it would not run.
      content.innerHTML = opened.html;
      content.hidden = false;
      form.remove();
      source.remove();
      if (opened.title) doc.title = opened.title;
      // Turned into the plugin's slideshow once there is one to turn.
      if (content.querySelector("figure.slideshow")) await import(SLIDESHOW_SCRIPT);
    } catch (error) {
      say(error instanceof WrongPasswordError ? LABELS.wrong : LABELS.broken);
      input.select();
    } finally {
      busy = false;
    }
  });
}

if (typeof document !== "undefined") boot(document);
