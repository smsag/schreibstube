/**
 * Render an ISO timestamp as `YYYY-MM-DD HH:MM`, in this device's time zone.
 *
 * Local, because a mail is read by the clock on the wall: in UTC, with no
 * zone said, a reply sent at nine in the morning in Berlin read as seven.
 * The shape stays locale-independent, since these values end up in note text
 * and in a result list, where sortable and stable beats localised. An
 * unparseable value is passed through rather than replaced, so a malformed
 * date from the server stays visible instead of silently becoming "Invalid
 * Date".
 */
export function formatIsoMinutes(iso: string | null | undefined): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const two = (n: number): string => String(n).padStart(2, "0");
  return (
    `${String(date.getFullYear()).padStart(4, "0")}-${two(date.getMonth() + 1)}-${two(date.getDate())} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}`
  );
}
