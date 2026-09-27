import { toArrayBuffer } from "./array-buffer";

/** A hex SHA-256 digest. Web Crypto is present in both Obsidian runtimes, desktop and mobile. */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
