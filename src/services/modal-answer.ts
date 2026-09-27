/**
 * A dialog's answer, given exactly once: what was chosen, or what closing it
 * means.
 *
 * Obsidian closes a dialog before it reports the choice made in it: a
 * suggestion list runs `close()` and only then `onChooseSuggestion`, and the
 * confirm dialog here does the same. A dialog that settled "dismissed" in its
 * `onClose` therefore settled before the choice arrived, and the choice was
 * thrown away — picking "Lebenslauf" in "Vorlage anlegen" did nothing at all.
 * A close only means "dismissed" if no choice follows it in the same turn, so
 * that answer waits for a microtask; a choice given meanwhile wins.
 */
export interface ModalAnswer<T> {
  /** The choice made in the dialog. The first answer given is the one kept. */
  choose(value: T): void;
  /** The dialog closed; `dismissed` is the answer unless a choice follows at once. */
  closed(dismissed: T): void;
}

export function modalAnswer<T>(resolve: (value: T) => void): ModalAnswer<T> {
  let settled = false;
  const settle = (value: T): void => {
    if (settled) return;
    settled = true;
    resolve(value);
  };
  return {
    choose: settle,
    closed: (dismissed) => {
      queueMicrotask(() => settle(dismissed));
    }
  };
}
