/**
 * Whether an answer from the network is larger than the caller allows.
 *
 * Every request the plugin makes has a deadline, and a deadline bounds how
 * long, not how much: a host that answers quickly with a few hundred
 * megabytes — a provider gone wrong, a proxy's error page, a server that is
 * not the one it should be — fills the memory of a phone before any parser
 * sees a byte. `requestUrl` cannot stream, so the body has arrived by the time
 * it can be measured; what can still be refused is using it.
 *
 * The declared length is read first, so an answer that says it is too large
 * is refused without being decoded, and the body is then measured in bytes,
 * since a server may declare nothing, or declare less than it sends.
 */

/** The `content-length` a response declares, or null when it declares none it means. */
export function declaredLength(headers: Record<string, string> | undefined): number | null {
  if (!headers) return null;
  const key = Object.keys(headers).find((name) => name.toLowerCase() === "content-length");
  const value = key === undefined ? undefined : headers[key]?.trim();
  if (!value || !/^\d+$/.test(value)) return null;
  return Number(value);
}

/** Whether the response is over `maxBytes`, by its own word or by its body. */
export function exceedsBytes(
  headers: Record<string, string> | undefined,
  body: ArrayBuffer | Uint8Array | string,
  maxBytes: number
): boolean {
  const declared = declaredLength(headers);
  if (declared !== null && declared > maxBytes) return true;
  if (typeof body !== "string") return body.byteLength > maxBytes;
  // A UTF-16 unit is never more than the UTF-8 bytes it stands for, so a
  // string too long in units is too long in bytes without being encoded.
  return body.length > maxBytes || new TextEncoder().encode(body).byteLength > maxBytes;
}

/** Bytes as a person reads them, in whole megabytes, for a message. */
export function megabytes(bytes: number): number {
  return Math.max(1, Math.round(bytes / 1_000_000));
}
