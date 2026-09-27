/**
 * The template a note is printed with when the vault offers none.
 *
 * Printing used to need a template in the vault before it did anything, and a
 * person who had just switched it on met a notice about folders instead of a
 * page. The plugin now carries one it can print with directly: the `standard`
 * example. It is part of the plugin, not of the vault — always there, never
 * deleted with a folder, and not something "Add a template" lays down, because
 * a copy by the same name would only raise the question which one prints.
 */
import { EXAMPLE_TEMPLATES, type ExampleTemplate } from "./print-examples";
import { LAYOUT_FILE, parseTemplate, type PrintTemplate } from "./print-template";

/** The name a note asks for it by, and the name it carries in the picker. */
export const BUILTIN_TEMPLATE_NAME = "Standard";

/**
 * Where the built-in "lives": nowhere a vault can hold. A colon is not allowed
 * in a vault path, so this can never be mistaken for a folder a person made.
 */
export const BUILTIN_TEMPLATE_FOLDER = ":builtin/Standard";

export interface BuiltinTemplate {
  template: PrintTemplate;
  layout: string;
}

/** The built-in template and its layout, or null if the build left it out. */
export function builtinTemplate(): BuiltinTemplate | null {
  const example = EXAMPLE_TEMPLATES.find((entry) => entry.name === BUILTIN_TEMPLATE_NAME);
  const layout = example?.files.find((file) => file.name === LAYOUT_FILE)?.text;
  if (!example || layout === undefined) return null;

  const { template } = parseTemplate(BUILTIN_TEMPLATE_FOLDER, example.frontmatter);
  return { template: { ...template, name: BUILTIN_TEMPLATE_NAME, builtIn: true }, layout };
}

/** The examples "Add a template" offers: every one but the built-in. */
export function copyableExamples(): ExampleTemplate[] {
  return EXAMPLE_TEMPLATES.filter((entry) => entry.name !== BUILTIN_TEMPLATE_NAME);
}
