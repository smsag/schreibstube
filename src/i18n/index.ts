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

/** The messages in the language currently in force. */
export function t(): Messages {
  return active;
}

export function setLanguage(preference: LanguagePreference): Locale {
  const locale = preference === "auto" ? obsidianLocale() : preference;
  active = CATALOGUES[locale];
  return locale;
}

/**
 * What language Obsidian itself is set to.
 *
 * Obsidian records it in local storage. Anything other than German is served
 * English, which is the honest behaviour for a plugin that speaks two
 * languages: a Spanish interface with German buttons would be worse than one
 * consistent fallback.
 */
export function obsidianLocale(): Locale {
  try {
    return window.localStorage.getItem("language") === "de" ? "de" : "en";
  } catch {
    // Private windows and hardened setups can refuse local storage entirely.
    return "en";
  }
}

export type { Messages };
