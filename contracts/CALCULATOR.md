# Calculation lines

A line that ends in `=` shows its result beside it, in Schreibstube (Obsidian)
and in a native macOS quick-note app alike. Both write into the same vault, so the same line
has to give the same result, to the character, and accepting it has to write
the same text. This file is the rule; `calculator-cases.json` holds the
examples both test suites run. A change here is a change in both apps.

Nothing is written into a note until the person accepts a result.

## 1. Which lines

The whole note is scanned, because some lines are not prose:

- **Frontmatter**: from a first line `---` to the next line `---` or `...`
  (trailing whitespace allowed on both, none before). Without that closing
  line there is no frontmatter, and the first line is prose like any other.
- **Fenced blocks**: a line opening, after at most three spaces, with three or
  more backticks or tildes, to a line with at least as many of the same
  character and nothing else; without one, to the end of the note.
- **Math blocks**: from a line that is `$$` (trimmed) to the next one, or the
  end of the note.
- **Comment blocks**: from a line that starts with `%%` (leading whitespace
  allowed) and holds no second `%%`, to the next line holding `%%`, or the
  end of the note.
- **Inline code**: a line with a backtick anywhere is passed over.

Every other line is a candidate when, with leading and trailing whitespace
removed, it is at most 500 characters long, ends in `=` and does not end in
`==` (that closes a highlight). The final `=` is removed, then one Markdown
prefix: `- [ ] `, `- [x] ` (any of `-*+`, `x` or `X`), `- `, `#`–`######`
and a space, `1. `, `> `. What is left must contain a digit.

**Labels.** Text may stand before the calculation: `Grundpreis 12,5 * 8 + 3 =`.
Each word start is tried in turn, from the first, so the longest tail is tried
first; the first tail that evaluates (section 4) is the result. A tail
evaluates only when it holds an operator (`+ - * /`, a unary minus included),
a `%`, or is a unit conversion; `Seite 5 =` shows nothing. A tail that starts
with `+`, `*`, `/` or `%` does not evaluate: `26.09.2026 + 1 =` is a date and
a stray sum, not `+ 1`.

## 2. Number formats

| Format       | Group  | Decimal | Example        |
| ------------ | ------ | ------- | -------------- |
| `comma`      | `.`    | `,`     | `1.234.567,89` |
| `point`      | `,`    | `.`     | `1,234,567.89` |
| `space`      | U+202F | `,`     | `1 234 567,89` |
| `apostrophe` | `’`    | `.`     | `1’234’567.89` |

Each app has a setting with these four and **automatic**: Schreibstube follows
Obsidian's language, the quick-note app the system's region. Automatic resolves to the
fixed format with the same decimal mark and group (a space of any width counts
as `space`; otherwise the decimal mark decides between `comma` and `point`).

**Reading a number.** A number is a run of digits with separators between
them: `.` `,` `'` `’` U+00A0 U+202F, and in the `space` format also a plain
space when exactly three digits follow it and no digit after those. Its value:

1. No `.` or `,`: separators only group.
2. Both `.` and `,`: the last of them is the decimal mark.
3. One kind, more than once: it groups.
4. Once, with anything but three digits after it: decimal mark.
5. Once, after a whole part that is `0`: decimal mark (`0,125`).
6. Once, in a number that also groups with a space or an apostrophe: decimal.
7. Otherwise — `1.234` — the format decides: it is the decimal mark when it is
   the format's decimal mark, else it groups.

Whatever is left of the decimal mark may group with one separator character
only — `'` and `’` are two, and so are a plain space, U+00A0 and U+202F —
with a first group of one to three digits and every other of three. After the
decimal mark there are digits only. Anything else (`26.09.2026`, `1'234’567`)
is not a number, and the tail fails. Lengths are counted in UTF-16 code units.

## 3. Currencies

Signs: `€` EUR, `$` USD, `£` GBP, `¥` JPY, `₹` INR, `₩` KRW, `₺` TRY,
`₪` ILS, `R$` BRL, `zł` PLN, `Kč` CZK (longest first, so `R$` is not a
dollar). Codes, upper case only: the `currencies` list in the cases file. An
amount carries at most one, before or after its number, with or without a
space: `12,50 €`, `€12,50`, `EUR 12,50`.

## 4. Evaluating

Operators: `+`, `-` (also `−` `–`), `*` (also `×` `·`), `/` (also `÷`),
parentheses (at most 32 deep), `%`, and `von` / `of` (any case) after a
percentage. Whitespace separates and is otherwise ignored. Anything else makes
the tail fail.

```
sum      = product { ("+" | "-") product }
product  = unary { ("*" | "/") unary }
unary    = ("-" | "+") unary | postfix
postfix  = primary [ "%" [ ("von" | "of") sum ] ]
primary  = amount | "(" sum ")"
```

A value is a number with an optional currency.

- **Percent.** `p% von x` is `(p / 100) * x`, and `x` is the rest of the
  tail: `10% von 200 + 5` is 20,5. In a sum, a term that is a bare percentage
  changes the running value `v` by that share, `v * (1 + p / 100)` or
  `v * (1 - p / 100)`: `200 + 10%` is 220, `200 - 10%` is 180,
  `200 + 10% + 5` is 225. Anywhere else `p%` is `p / 100`: `200 * 10%` is 20.
  The arithmetic is IEEE double precision, in exactly these steps, so the
  two apps round the same last bit.
- **Currencies.** `+` and `-`: a number without a currency takes the other
  side's; two different currencies fail (Schreibstube may convert, section 6).
  `*`: at most one side carries a currency, which the result keeps. `/`: a
  currency divided by a number keeps it; divided by the same currency it is a
  plain number; anything else fails. A percentage carries none, and a `%` on
  an amount with a currency (`10 €%`) fails.
- **Signs.** A bare percentage is a percentage without a sign of its own:
  `200 + -10%` is `200 + (-0,1)`, which is 199,9.
- **Fails**: division by zero, a result that is not finite or is a
  quadrillion (10^15) or more either way, a tail with nothing but a number in
  it.

**Unit conversion** is tried before the grammar, on the whole tail:
`[-]number unit (in | to | nach | -> | →) unit` (the minus also `−` or `–`), units and the connecting
word in any case, both units of one kind: `-5 C in F` is 23, `3 KM IN M`
is 3.000. The result is `((value * factor + offset) - offset₂) / factor₂`, with
the target's factor and offset second. The table is `units` in the cases file; it holds the
factors Apple's Foundation uses, so the quick-note app's results did not move.

## 5. Writing the result

Rounded to two decimals, halves away from zero — `sign(v) * round(|v| * 100) / 100`
with `round` to the nearest integer — and `-0` is `0`. The whole part is
grouped in threes with the format's group, the decimal mark is the format's,
and a negative value starts with `-`, before a currency too (`-€5,00`). The
digits come from the whole number of cents, `round(|v| * 100)`, so a result
near the limit is written exactly.

- **Without a currency**: at most two decimals, trailing zeros dropped —
  `103`, `11,4`, `3.000`, `22,22`.
- **With a currency**: always two decimals, and the currency the way the first
  amount carrying it wrote it: a sign or code written before the number goes
  before it (a code with a space, a sign without), one written after goes after
  it with a space — `37,50 €`, `€37,50`, `EUR 37,50`, `-5,00 €`.

**Accepting** puts one space and the result after the `=`, replacing any
whitespace that followed it: `12,5 * 8 + 3 =  ` becomes `12,5 * 8 + 3 = 103`.
That line no longer ends in `=` and is no longer a calculation.

## 6. What only one app does

- **Schreibstube converts mixed currencies** when its own setting says so, at
  the European Central Bank's daily rates, into its default currency. Such a
  result starts with `≈ ` and ends with ` · ECB` and the rates' day, so it is
  plain whose numbers they are; the quick-note app shows nothing for that line.
- Where the result shows, how it is accepted (Tab at the end of the line, a
  click, a tap) and how it looks are each app's own.
