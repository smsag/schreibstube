/**
 * Interface language.
 *
 * The plugin was half English and half German, which read as unfinished. Both
 * languages are now first class: English is the reference catalogue and gives
 * the message type, German has to satisfy it, so a missing translation is a
 * compile error rather than a gap someone notices in the interface.
 *
 * The default follows Obsidian's own language, because a person who set the app
 * to German did not mean "German, except this plugin". The setting is there for
 * the case where they did.
 */
import { de } from "./de";
import { en, type Messages } from "./en";

export type Locale = "de" | "en";
export type LanguagePreference = Locale | "auto";

const CATALOGUES: Record<Locale, Messages> = { de, en };

let active: Messages = en;
let activeCode: Locale = "en";

/** The messages in the language currently in force. */
export function t(): Messages {
  return active;
}

/** Which language that is, for the few decisions that need the name and not
 *  the words — a date written the way the language writes one. */
export function activeLocale(): Locale {
  return activeCode;
}

export function setLanguage(preference: LanguagePreference): Locale {
  const locale = preference === "auto" ? obsidianLocale() : preference;
  active = CATALOGUES[locale];
  activeCode = locale;
  return locale;
}

/**
 * What language Obsidian itself is set to.
 *
 * Obsidian records an explicit choice in local storage and, when nobody ever
 * chose, follows the system: that is the app's own rule, read from the app.
 * Reading only the stored choice was wrong on every machine where German came
 * from macOS rather than from the settings — Obsidian's palette spoke German
 * and this plugin's commands were named in English, so "Aufgaben" found
 * nothing. Anything other than German is served English, which is the honest
 * behaviour for a plugin that speaks two languages: a Spanish interface with
 * German buttons would be worse than one consistent fallback.
 */
export function obsidianLocale(): Locale {
  return localeFrom(storedLanguage(), typeof navigator === "undefined" ? "" : navigator.language);
}

/** The locale for Obsidian's stored language, or the system's when none is stored. */
export function localeFrom(stored: string | null, system: string): Locale {
  const language = (stored ?? system ?? "").trim().toLowerCase();
  return language.split(/[-_]/)[0] === "de" ? "de" : "en";
}

function storedLanguage(): string | null {
  try {
    return window.localStorage.getItem("language");
  } catch {
    // Private windows and hardened setups can refuse local storage entirely.
    return null;
  }
}

export type { Messages };
