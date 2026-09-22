/**
 * The grounds the explorer pane can sit on, in the themes we can measure.
 *
 * A rule drawn on the filter field has to stand clear of whatever is behind
 * the pane, and a plugin does not get to know what that is. This file does not
 * pretend otherwise: it is the evidence behind the two percentages in
 * `styles.css`, not a claim about every theme. Read in Obsidian 1.13.7 over
 * the debugging port.
 *
 * All three background tokens are listed rather than the one the pane happens
 * to paint today, because a theme may paint a sidebar with any of them and the
 * field must survive that without anyone re-measuring.
 *
 * Klartext is here because it is the theme this plugin is developed against
 * and because it is the binding case: its body text is softer than Obsidian's,
 * so the same mix of --text-normal lands paler.
 */
export const GROUNDS_MEASURED_IN = "Obsidian 1.13.7";

export interface ThemeGrounds {
  /** `--text-normal`, which the rule is mixed from. */
  text: string;
  /** Every background a pane may be drawn on, darkest contrast first. */
  backgrounds: string[];
}

export const THEME_GROUNDS: Record<"light" | "dark", Record<string, ThemeGrounds>> = {
  light: {
    "Obsidian default": { text: "#222222", backgrounds: ["#ffffff", "#f6f6f6", "#fcfcfc"] },
    Klartext: { text: "#333333", backgrounds: ["#ffffff", "#f7f7f5", "#f0f0ed"] }
  },
  dark: {
    "Obsidian default": { text: "#dadada", backgrounds: ["#1C1C1C", "#282828", "#333333"] },
    Klartext: { text: "#d4d4d0", backgrounds: ["#1a1a1a", "#222222", "#2a2a2a"] }
  }
};

/** WCAG 2.2, 1.4.11: the boundary of a user-interface component. */
export const UI_BOUNDARY_CONTRAST = 3;
