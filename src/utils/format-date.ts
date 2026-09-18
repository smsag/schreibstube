/**
 * Render an ISO timestamp as `YYYY-MM-DD HH:MM`.
 *
 * Deliberately locale-independent: these values end up in note text and in a
 * result list, where sortable and stable beats localised. An unparseable value
 * is passed through rather than replaced, so a malformed date from the server
 * stays visible instead of silently becoming "Invalid Date".
 */
export function formatIsoMinutes(iso: string | null | undefined): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().replace("T", " ").slice(0, 16);
}
