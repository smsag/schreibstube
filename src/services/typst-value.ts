/**
 * Turning JavaScript values into Typst source.
 *
 * Everything the plugin hands a template crosses this boundary: a sender's
 * name, a recipient pasted from an email, a file name from the vault. Typst
 * source is code, so a value that is pasted into it unescaped is an injection
 * — a name containing a quote would at best fail to compile and at worst run
 * whatever followed it. Values therefore never become markup here; they become
 * string literals, which have exactly one escape rule.
 */

/**
 * A Typst string literal.
 *
 * Only backslash and the double quote need escaping inside one. Control
 * characters are written as `\u{…}` rather than passed through, because a
 * stray newline in a data value would otherwise end the literal.
 */
export function typstString(value: string): string {
  let out = '"';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\\") out += "\\\\";
    else if (char === '"') out += '\\"';
    else if (char === "\n") out += "\\n";
    else if (char === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) out += `\\u{${code.toString(16)}}`;
    else out += char;
  }
  return `${out}"`;
}

/** A Typst dictionary literal, with the keys in the order they were given. */
export function typstDictionary(data: Readonly<Record<string, string>>): string {
  const entries = Object.entries(data);
  if (entries.length === 0) return "(:)";
  return `(${entries.map(([key, value]) => `${typstKey(key)}: ${typstString(value)}`).join(", ")})`;
}

/**
 * A key a Typst dictionary will accept.
 *
 * Identifiers are written bare, which is what a template author reads in
 * `data.senderName`. Anything else — a key with a space or a dash, which
 * frontmatter allows — is quoted, and the template reaches it with
 * `data.at("…")`.
 */
export function typstKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) && !key.endsWith("-") ? key : typstString(key);
}

/** A length such as `25mm` or `1.5cm`, or null when the text is not one. */
export function typstLength(value: string): string | null {
  const match = /^(-?\d+(?:\.\d+)?)\s*(mm|cm|in|pt|em)$/.exec(value.trim());
  return match ? `${match[1]}${match[2]}` : null;
}

/**
 * A list of values as Typst reads one.
 *
 * The single-element case needs its trailing comma: `("a")` is a parenthesised
 * string and `("a",)` is an array of one, and a helper that iterates the first
 * would iterate its characters. One diagram in a fence is the common case, so
 * this is the case that has to be right.
 */
export function typstArray(values: readonly string[]): string {
  if (values.length === 0) return "()";
  if (values.length === 1) return `(${typstString(values[0] as string)},)`;
  return `(${values.map((value) => typstString(value)).join(", ")})`;
}
