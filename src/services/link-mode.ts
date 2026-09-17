/**
 * Where an internal link opens, and which way the one command moves it.
 */

export type LinkOpenMode = "default" | "left" | "right";

/**
 * The mode after this one: normal, then left, then right, then normal again.
 *
 * One command walks the three because each was a command of its own, and a
 * person reaching for any of them wanted the one after where they were.
 */
export function nextLinkMode(mode: LinkOpenMode): LinkOpenMode {
  switch (mode) {
    case "default":
      return "left";
    case "left":
      return "right";
    case "right":
      return "default";
  }
}
