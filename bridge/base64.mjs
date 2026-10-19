/**
 * Base64 in a JSON body, checked and measured before it is decoded: the
 * decoded size is three quarters of the text, so a file too large is refused
 * without being materialised.
 */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Whether the text is base64 in the standard alphabet, padded to whole quads. */
export function isBase64(text) {
  return typeof text === "string" && text.length % 4 === 0 && BASE64.test(text);
}

/** How many bytes a checked base64 text decodes to. */
export function decodedLength(text) {
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  return (text.length / 4) * 3 - padding;
}
