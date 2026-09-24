/** Escaping for text and attribute values the renderer writes by hand. */

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
