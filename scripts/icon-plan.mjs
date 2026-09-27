/**
 * Which glyphs a font build takes from where, decided before any tool runs.
 *
 * Kept apart from `build-icon-font.mjs` so the decisions can be tested without
 * the Tabler package, fonttools or a file system: every refusal here is one
 * that would otherwise ship an empty square or the wrong glyph.
 */

/**
 * Where our own glyphs start: Supplementary Private Use Area-A. Tabler lives in
 * the BMP's private area and just past it (U+EA02 to U+1028D), so a plane of
 * its own keeps the two from meeting however far Tabler grows.
 */
export const CUSTOM_CODEPOINT_BASE = 0xf0000;

/**
 * @param {string[]} wanted every name the build ships
 * @param {Map<string, number>} available Tabler's names and codepoints
 * @param {{ name: string, source: string }[]} custom our own glyphs
 * @returns {{ errors: string[], tabler: string[], custom: { name: string, source: string, codepoint: number }[] }}
 */
export function planIconFont(wanted, available, custom) {
  const errors = [];
  const customNames = new Set();

  for (const icon of custom) {
    if (customNames.has(icon.name)) errors.push(`"${icon.name}" is listed twice in CUSTOM_ICONS.`);
    if (available.has(icon.name)) {
      errors.push(`"${icon.name}" is a Tabler name too; give our own glyph another one.`);
    }
    customNames.add(icon.name);
  }

  const unknown = wanted.filter((name) => !available.has(name) && !customNames.has(name));
  if (unknown.length > 0) {
    errors.push(
      `Unknown icon names in scripts/icon-set.mjs: ${unknown.join(", ")}.\n` +
        "Check the name against https://tabler.io/icons — a typo would ship an empty square."
    );
  }

  const shipped = new Set(wanted);
  return {
    errors,
    tabler: wanted.filter((name) => !customNames.has(name)),
    // Codepoints by position in the list, so an appended icon never moves an
    // existing one and leaving one out of every group renumbers nothing.
    custom: custom
      .map((icon, index) => ({ ...icon, codepoint: CUSTOM_CODEPOINT_BASE + index }))
      .filter((icon) => shipped.has(icon.name))
  };
}
