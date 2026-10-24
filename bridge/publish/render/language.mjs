/**
 * The language a page is in, and the few words the bridge writes itself.
 *
 * Two catalogues and no more: German, which every page always was, and
 * English for any other language, the one a reader of a language the bridge
 * has no words for most likely reads. The plugin checks a language by the
 * same rule before it sends one (contracts/language-cases.json).
 */

/** The language a page is in when nothing says otherwise: what it always was. */
export const DEFAULT_LANGUAGE = "de";

/** The longest tag taken: room for a language, a script, a region and a variant. */
export const MAX_LANGUAGE_CHARS = 35;

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,4}$/;

/**
 * A language tag as a page's `lang` takes it: `de`, `en`, `en-GB`, `pt-BR`.
 * Only its shape is checked; a browser treats a tag it does not know as
 * unknown, which is harmless, but a quote in one would break the page.
 */
export function isLanguageTag(value) {
  return (
    typeof value === "string" && value.length <= MAX_LANGUAGE_CHARS && LANGUAGE_TAG.test(value)
  );
}

/** Whether a page in this language gets the German words. */
export function isGerman(lang) {
  return /^de(-|$)/i.test(String(lang ?? DEFAULT_LANGUAGE));
}
