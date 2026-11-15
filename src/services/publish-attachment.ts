/**
 * What this device may be asked to load for a publish.
 *
 * An attachment is read whole to be hashed, and a phone's WebView answers a
 * file that size by being killed. The bound is about this device's memory,
 * not the bridge's limits: an operator can raise those, and the plugin must
 * not refuse what a bridge would take.
 */
export const MAX_PUBLISH_ATTACHMENT_BYTES = 100_000_000;

/** Whether a file of this size may be read into memory for a publish. */
export function isReadableAttachment(bytes: number): boolean {
  return bytes <= MAX_PUBLISH_ATTACHMENT_BYTES;
}
