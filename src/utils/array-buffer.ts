/**
 * A view's own bytes as an `ArrayBuffer`, which is what `crypto.subtle` and
 * the vault's binary writers take. A `Uint8Array` may be a window onto a
 * larger buffer, so handing over `.buffer` would hand over its neighbours too.
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
