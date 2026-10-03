/**
 * Calculation lines: a line that ends in `=` shows its result beside it.
 *
 * A quick-note app that writes into the same vault does the same
 * thing, and a line has to give the same result in both, to the character.
 * The rule is `contracts/CALCULATOR.md` and its examples are
 * `contracts/calculator-cases.json`; both apps run every one of them. Nothing
 * here is Schreibstube's own except the conversion of mixed currencies, which
 * the other app has no rates for and leaves alone.
 *
 * Note text is untrusted and a line is evaluated on every keystroke near it:
 * a line is bounded in length and nesting, and evaluated by a small parser
 * that knows numbers, currencies and the four operations — never `eval`.
 */
import { readNumber, type NumberFormat } from "./amounts";
import { convert, type ExchangeRates } from "./exchange-rates";

/** A longer line is not a sum anyone types. */
export const MAX_CALCULATION_LINE = 500;

/** Parentheses deeper than this are a paste, not arithmetic. */
const MAX_DEPTH = 32;

/** A result this large has lost the cents it would be written with. */
const MAX_RESULT = 1e15;

/** The four fixed formats of the contract; automatic resolves to one of them. */
export type CalculationFormat = "comma" | "point" | "space" | "apostrophe";

const FORMATS: Record<CalculationFormat, { group: string; decimal: "." | ","; locale: string }> = {
  comma: { group: ".", decimal: ",", locale: "de-DE" },
  point: { group: ",", decimal: ".", locale: "en-US" },
  space: { group: "\u202f", decimal: ",", locale: "fr-FR" },
  apostrophe: { group: "’", decimal: ".", locale: "de-CH" }
};

/**
 * The fixed format a reading format stands for: the one with its decimal mark
 * and its kind of group. Automatic follows Obsidian's language through Intl,
 * and a language this plugin never heard of still lands on one of the four.
 */
export function calculationFormatFor(format: NumberFormat): CalculationFormat {
  if (format.spaceGroups) return "space";
  if (format.decimal === ",") return "comma";
  let group = ",";
  try {
    group =
      new Intl.NumberFormat(format.locale).formatToParts(1234567).find((p) => p.type === "group")
        ?.value ?? ",";
  } catch {
    // An unknown locale groups the English way.
  }
  return group === "’" || group === "'" ? "apostrophe" : "point";
}

/** Signs that name one currency, longest first so `R$` is not a dollar. */
export const CALCULATION_SIGNS: Readonly<Record<string, string>> = {
  "€": "EUR",
  $: "USD",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  "₩": "KRW",
  "₺": "TRY",
  "₪": "ILS",
  R$: "BRL",
  zł: "PLN",
  Kč: "CZK"
};
const SIGNS_LONGEST_FIRST = Object.keys(CALCULATION_SIGNS).sort((a, b) => b.length - a.length);

interface Unit {
  kind: "length" | "mass" | "temperature" | "data";
  factor: number;
  offset: number;
}

/** The factors Apple's Foundation uses, so the other app's results did not move when the rule was shared. */
export const CALCULATION_UNITS: Readonly<Record<string, Unit>> = {
  mm: { kind: "length", factor: 0.001, offset: 0 },
  cm: { kind: "length", factor: 0.01, offset: 0 },
  m: { kind: "length", factor: 1, offset: 0 },
  km: { kind: "length", factor: 1000, offset: 0 },
  in: { kind: "length", factor: 0.0254, offset: 0 },
  inch: { kind: "length", factor: 0.0254, offset: 0 },
  ft: { kind: "length", factor: 0.3048, offset: 0 },
  yd: { kind: "length", factor: 0.9144, offset: 0 },
  mi: { kind: "length", factor: 1609.344, offset: 0 },
  mg: { kind: "mass", factor: 1e-6, offset: 0 },
  g: { kind: "mass", factor: 0.001, offset: 0 },
  kg: { kind: "mass", factor: 1, offset: 0 },
  t: { kind: "mass", factor: 1000, offset: 0 },
  oz: { kind: "mass", factor: 0.0283495, offset: 0 },
  lb: { kind: "mass", factor: 0.453592, offset: 0 },
  lbs: { kind: "mass", factor: 0.453592, offset: 0 },
  c: { kind: "temperature", factor: 1, offset: 273.15 },
  "°c": { kind: "temperature", factor: 1, offset: 273.15 },
  f: { kind: "temperature", factor: 0.55555555555556002, offset: 255.37222222222428 },
  "°f": { kind: "temperature", factor: 0.55555555555556002, offset: 255.37222222222428 },
  k: { kind: "temperature", factor: 1, offset: 0 },
  b: { kind: "data", factor: 1, offset: 0 },
  kb: { kind: "data", factor: 1000, offset: 0 },
  mb: { kind: "data", factor: 1_000_000, offset: 0 },
  gb: { kind: "data", factor: 1_000_000_000, offset: 0 },
  tb: { kind: "data", factor: 1_000_000_000_000, offset: 0 },
  kib: { kind: "data", factor: 1024, offset: 0 },
  mib: { kind: "data", factor: 1_048_576, offset: 0 },
  gib: { kind: "data", factor: 1_073_741_824, offset: 0 },
  tib: { kind: "data", factor: 1_099_511_627_776, offset: 0 }
};

/** What a calculation may draw on beyond the line itself. */
export interface CalculationContext {
  format: CalculationFormat;
  /** The ISO codes an amount may carry. */
  currencies: readonly string[];
  /**
   * Schreibstube's own: mixed currencies converted into this one at these
   * rates, the result naming `day` as theirs. Without it — and always in
   * the other app — a mix shows nothing.
   */
  conversion?: { into: string; rates: ExchangeRates; day: string } | null;
}

/** A result as shown beside its line, and as accepted into it. */
export interface CalculationResult {
  text: string;
}

// --- which lines ---------------------------------------------------------

const PREFIX = /^\s*(?:[-*+] \[[ xX]\] |[-*+] |#{1,6} |\d+\. |> )/;

/**
 * Every line of a note that shows a result, by index, skipping what is not
 * prose: frontmatter, fenced code, math and comment blocks, and any line with
 * inline code in it.
 */
export function calculationLines(
  text: string,
  ctx: CalculationContext
): { line: number; result: string }[] {
  const found: { line: number; result: string }[] = [];
  forEachProseLine(text, (line, index) => {
    const result = calculateLine(line, ctx);
    if (result) found.push({ line: index, result: result.text });
  });
  return found;
}

/**
 * Calls `visit` with each line that is prose, by index. Exported for the
 * editor and Reading view, which walk the same lines and evaluate only those
 * they have on screen.
 */
export function forEachProseLine(text: string, visit: (line: string, index: number) => void): void {
  const lines = text.split(/\r?\n/);
  let fence: { char: string; length: number } | null = null;
  let block: "math" | "comment" | null = null;
  // Frontmatter only when it closes: an open `---` on the first line is a
  // rule, and the lines under it are prose.
  const rule = (line: string | undefined, ...marks: string[]): boolean =>
    line !== undefined && marks.includes(line.trimEnd());
  let frontmatter =
    rule(lines[0], "---") && lines.slice(1).some((line) => rule(line, "---", "..."));

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (frontmatter) {
      if (index > 0 && rule(line, "---", "...")) frontmatter = false;
      return;
    }
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close?.[1] && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      return;
    }
    if (block === "math") {
      if (trimmed === "$$") block = null;
      return;
    }
    if (block === "comment") {
      if (trimmed.includes("%%")) block = null;
      return;
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (open?.[1]) {
      fence = { char: open[1][0] ?? "`", length: open[1].length };
      return;
    }
    if (trimmed === "$$") {
      block = "math";
      return;
    }
    if (trimmed.startsWith("%%") && !trimmed.slice(2).includes("%%")) {
      block = "comment";
      return;
    }
    if (line.includes("`")) return;
    visit(line, index);
  });
}

/** The result a single line shows, or null when it is not a calculation. */
export function calculateLine(raw: string, ctx: CalculationContext): CalculationResult | null {
  const line = raw.trim();
  if (line.length > MAX_CALCULATION_LINE) return null;
  if (!line.endsWith("=") || line.endsWith("==")) return null;
  const body = line.slice(0, -1).replace(PREFIX, "");
  if (!/\d/.test(body)) return null;

  for (const start of wordStarts(body)) {
    const tail = body.slice(start).trim();
    if (/^[+*/%]/.test(tail)) continue;
    const result = evaluateTail(tail, ctx);
    if (result) return result;
  }
  return null;
}

/** The line with its result written after the `=`, or null when it shows none. */
export function acceptedLine(raw: string, ctx: CalculationContext): string | null {
  const result = calculateLine(raw, ctx);
  if (!result) return null;
  const end = raw.trimEnd();
  return `${end} ${result.text}`;
}

function wordStarts(text: string): number[] {
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const here = text[i] ?? "";
    const before = i === 0 ? " " : (text[i - 1] ?? " ");
    if (!/\s/.test(here) && /\s/.test(before)) starts.push(i);
  }
  return starts;
}

// --- evaluating ----------------------------------------------------------

/** A currency as the first amount carrying it wrote it. */
interface Written {
  code: string;
  token: string;
  before: boolean;
}

interface Value {
  value: number;
  currency: Written | null;
  /** Converted, when a mix was: the rates' day as written. */
  rateDate: string | null;
}

/** A bare percentage, kept apart until a sum knows what it is a share of. */
interface Percent {
  percent: number;
}

type Token =
  | { kind: "number"; value: number }
  | { kind: "currency"; code: string; token: string }
  | { kind: "op"; op: "+" | "-" | "*" | "/" | "%" | "(" | ")" }
  | { kind: "of" };

const OPERATORS: Record<string, "+" | "-" | "*" | "/" | "%" | "(" | ")"> = {
  "+": "+",
  "-": "-",
  "−": "-",
  "–": "-",
  "*": "*",
  "×": "*",
  "·": "*",
  "/": "/",
  "÷": "/",
  "%": "%",
  "(": "(",
  ")": ")"
};

const CONVERSION =
  /^([-−–]?\d[\d.,'’\u00a0\u202f]*)\s*([A-Za-zµ°]+)\s+(?:in|to|nach|->|→)\s+([A-Za-zµ°]+)$/i;

function evaluateTail(tail: string, ctx: CalculationContext): CalculationResult | null {
  if (tail === "" || !/\d/.test(tail)) return null;
  const converted = convertUnits(tail, ctx);
  if (converted !== null) return { text: formatPlain(converted, ctx.format) };

  const tokens = tokenize(tail, ctx);
  if (!tokens) return null;
  const parser = new Parser(tokens, ctx);
  const value = parser.parse();
  if (!value || !parser.sawOperator) return null;
  if (!Number.isFinite(value.value) || Math.abs(value.value) >= MAX_RESULT) return null;
  return { text: formatValue(value, ctx) };
}

function convertUnits(tail: string, ctx: CalculationContext): number | null {
  const match = CONVERSION.exec(tail);
  if (!match) return null;
  const [, written = "", fromName = "", toName = ""] = match;
  const negative = /^[-−–]/.test(written);
  const number = readNumber(negative ? written.slice(1) : written, readingFormat(ctx.format));
  const from = CALCULATION_UNITS[fromName.toLowerCase()];
  const to = CALCULATION_UNITS[toName.toLowerCase()];
  if (!number || !from || !to || from.kind !== to.kind) return null;
  const value = negative ? -number.value : number.value;
  const result = (value * from.factor + from.offset - to.offset) / to.factor;
  return Number.isFinite(result) && Math.abs(result) < MAX_RESULT ? result : null;
}

function readingFormat(format: CalculationFormat): NumberFormat {
  const { decimal, locale } = FORMATS[format];
  return { locale, decimal, spaceGroups: format === "space" };
}

function tokenize(text: string, ctx: CalculationContext): Token[] | null {
  const tokens: Token[] = [];
  const reading = readingFormat(ctx.format);
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/\d/.test(ch)) {
      const end = numberEnd(text, i, ctx.format);
      const number = readNumber(text.slice(i, end), reading);
      if (!number) return null;
      tokens.push({ kind: "number", value: number.value });
      i = end;
      continue;
    }
    const op = OPERATORS[ch];
    if (op) {
      tokens.push({ kind: "op", op });
      i++;
      continue;
    }
    const sign = SIGNS_LONGEST_FIRST.find((s) => text.startsWith(s, i));
    if (sign) {
      tokens.push({ kind: "currency", code: CALCULATION_SIGNS[sign] ?? "", token: sign });
      i += sign.length;
      continue;
    }
    const word = /^\p{L}+/u.exec(text.slice(i))?.[0] ?? "";
    if (word.length === 3 && ctx.currencies.includes(word)) {
      tokens.push({ kind: "currency", code: word, token: word });
      i += 3;
      continue;
    }
    if (/^(?:von|of)$/i.test(word)) {
      tokens.push({ kind: "of" });
      i += word.length;
      continue;
    }
    return null;
  }
  return tokens;
}

/** Where a number that starts at `start` ends: digits, and separators between digits. */
function numberEnd(text: string, start: number, format: CalculationFormat): number {
  let i = start;
  while (/\d/.test(text[i] ?? "")) i++;
  for (;;) {
    const sep = text[i] ?? "";
    if (/[.,'’\u00a0\u202f]/.test(sep) && /\d/.test(text[i + 1] ?? "")) {
      i++;
      while (/\d/.test(text[i] ?? "")) i++;
      continue;
    }
    if (format === "space" && sep === " " && /^\d{3}(?!\d)/.test(text.slice(i + 1))) {
      i += 4;
      continue;
    }
    return i;
  }
}

class Parser {
  private at = 0;
  private depth = 0;
  sawOperator = false;

  constructor(
    private readonly tokens: Token[],
    private readonly ctx: CalculationContext
  ) {}

  parse(): Value | null {
    const value = this.sum();
    if (!value || this.at !== this.tokens.length) return null;
    return asValue(value);
  }

  private peek(): Token | undefined {
    return this.tokens[this.at];
  }

  private takeOp(...ops: string[]): string | null {
    const token = this.peek();
    if (token?.kind === "op" && ops.includes(token.op)) {
      this.at++;
      return token.op;
    }
    return null;
  }

  private sum(): Value | Percent | null {
    let left = this.product();
    if (!left) return null;
    for (;;) {
      const op = this.takeOp("+", "-");
      if (!op) return left;
      this.sawOperator = true;
      const right = this.product();
      if (!right) return null;
      const base = asValue(left);
      if ("percent" in right) {
        const share = right.percent / 100;
        left = { ...base, value: base.value * (op === "+" ? 1 + share : 1 - share) };
        continue;
      }
      left = this.add(base, right, op === "+" ? 1 : -1);
      if (!left) return null;
    }
  }

  private add(a: Value, b: Value, sign: 1 | -1): Value | null {
    const rateDate = a.rateDate ?? b.rateDate;
    if (!a.currency || !b.currency || a.currency.code === b.currency.code) {
      return { value: a.value + sign * b.value, currency: a.currency ?? b.currency, rateDate };
    }
    const conversion = this.ctx.conversion;
    if (!conversion) return null;
    const left = convert(a.value, a.currency.code, conversion.into, conversion.rates);
    const right = convert(b.value, b.currency.code, conversion.into, conversion.rates);
    if (left === null || right === null) return null;
    const into =
      a.currency.code === conversion.into
        ? a.currency
        : b.currency.code === conversion.into
          ? b.currency
          : { code: conversion.into, token: conversion.into, before: false };
    return { value: left + sign * right, currency: into, rateDate: conversion.day };
  }

  private product(): Value | Percent | null {
    let left = this.unary();
    if (!left) return null;
    for (;;) {
      const op = this.takeOp("*", "/");
      if (!op) return left;
      this.sawOperator = true;
      const right = this.unary();
      if (!right) return null;
      const a = asValue(left);
      const b = asValue(right);
      const rateDate = a.rateDate ?? b.rateDate;
      if (op === "*") {
        if (a.currency && b.currency) return null;
        left = { value: a.value * b.value, currency: a.currency ?? b.currency, rateDate };
        continue;
      }
      if (b.value === 0) return null;
      if (b.currency && (!a.currency || a.currency.code !== b.currency.code)) return null;
      left = { value: a.value / b.value, currency: b.currency ? null : a.currency, rateDate };
    }
  }

  private unary(): Value | Percent | null {
    const op = this.takeOp("-", "+");
    if (op) {
      this.sawOperator = true;
      const inner = this.unary();
      if (!inner) return null;
      const value = asValue(inner);
      return op === "-" ? { ...value, value: -value.value } : value;
    }
    return this.postfix();
  }

  private postfix(): Value | Percent | null {
    const primary = this.primary();
    if (!primary) return null;
    if (!this.takeOp("%")) return primary;
    this.sawOperator = true;
    if (primary.currency) return null;
    if (this.peek()?.kind === "of") {
      this.at++;
      const whole = this.sum();
      if (!whole) return null;
      const of = asValue(whole);
      return { ...of, value: (primary.value / 100) * of.value };
    }
    return { percent: primary.value };
  }

  private primary(): Value | null {
    if (this.takeOp("(")) {
      if (++this.depth > MAX_DEPTH) return null;
      const inner = this.sum();
      if (!inner || !this.takeOp(")")) return null;
      this.depth--;
      return asValue(inner);
    }
    let currency: Written | null = null;
    const first = this.peek();
    if (first?.kind === "currency") {
      currency = { code: first.code, token: first.token, before: true };
      this.at++;
    }
    const number = this.peek();
    if (number?.kind !== "number") return null;
    this.at++;
    const after = this.peek();
    if (after?.kind === "currency") {
      if (currency) return null;
      currency = { code: after.code, token: after.token, before: false };
      this.at++;
    }
    return { value: number.value, currency, rateDate: null };
  }
}

function asValue(value: Value | Percent): Value {
  return "percent" in value
    ? { value: value.percent / 100, currency: null, rateDate: null }
    : value;
}

// --- writing -------------------------------------------------------------

function rounded(value: number): number {
  const result = (Math.sign(value) * Math.round(Math.abs(value) * 100)) / 100;
  return result === 0 ? 0 : result;
}

/** Digits grouped in threes, with the format's group and decimal marks. */
function layout(value: number, places: "upTo2" | "exactly2", format: CalculationFormat): string {
  const { group, decimal } = FORMATS[format];
  const negative = value < 0;
  // From the whole number of cents: `toFixed` drifts a cent near the limit.
  const allCents = Math.round(Math.abs(value) * 100);
  const whole = String(Math.floor(allCents / 100));
  const cents = String(allCents % 100).padStart(2, "0");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const fraction = places === "exactly2" ? cents : cents.replace(/0+$/, "");
  return `${negative ? "-" : ""}${grouped}${fraction ? decimal + fraction : ""}`;
}

function formatPlain(value: number, format: CalculationFormat): string {
  return layout(rounded(value), "upTo2", format);
}

function formatValue(result: Value, ctx: CalculationContext): string {
  const value = rounded(result.value);
  if (!result.currency) return formatPlain(value, ctx.format);
  const number = layout(Math.abs(value), "exactly2", ctx.format);
  const minus = value < 0 ? "-" : "";
  const { token, before } = result.currency;
  const isCode = /^[A-Z]{3}$/.test(token);
  const amount = before
    ? `${minus}${token}${isCode ? " " : ""}${number}`
    : `${minus}${number} ${token}`;
  return result.rateDate ? `≈ ${amount} · ECB ${result.rateDate}` : amount;
}
