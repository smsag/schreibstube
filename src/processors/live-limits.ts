/**
 * Above this the live editor extensions leave a note alone.
 *
 * Each of them reads the document on a keystroke, and a note this long is not
 * prose anyone is typing into: it is a log, an export, a pasted dump. The
 * on-demand tools — the sidebar scan, the ribbon block — still answer for it;
 * only the always-on decorations step aside. One figure for all of them, so
 * "too long for the underline" and "too long for the glyphs" are the same note.
 */
export const MAX_LIVE_CHARS = 200_000;
