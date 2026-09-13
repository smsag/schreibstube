/**
 * Longest-common-subsequence diff over a sequence of comparable items.
 *
 * Shared by the word-level diff that turns a rewrite into review cards and the
 * line-level diff that turns a remote document update into them, so the two
 * cannot drift apart in how they decide what changed.
 */

export type DiffOp = "equal" | "insert" | "delete";

export interface DiffRun<T> {
  op: DiffOp;
  items: T[];
}

/**
 * Diff `a` against `b`, returning contiguous runs.
 *
 * Above `maxItems` on either side the quadratic table is not worth building,
 * and a change that large is a whole-block decision anyway, so the result
 * degrades to a single delete followed by a single insert.
 */
export function diffSequences<T>(a: T[], b: T[], maxItems: number): DiffRun<T>[] {
  if (a.length > maxItems || b.length > maxItems) {
    const runs: DiffRun<T>[] = [];
    if (a.length > 0) runs.push({ op: "delete", items: a });
    if (b.length > 0) runs.push({ op: "insert", items: b });
    return runs;
  }

  return backtrack(a, b, lcsTable(a, b));
}

function lcsTable<T>(a: T[], b: T[]): Uint32Array {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      // The border row and column stay zero, which is also what a read past
      // the table would mean.
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }

  return table;
}

function backtrack<T>(a: T[], b: T[], table: Uint32Array): DiffRun<T>[] {
  const width = b.length + 1;
  const runs: DiffRun<T>[] = [];
  let i = 0;
  let j = 0;

  const push = (op: DiffOp, item: T): void => {
    const last = runs[runs.length - 1];
    if (last && last.op === op) {
      last.items.push(item);
      return;
    }
    runs.push({ op, items: [item] });
  };

  // `T` may itself include undefined, so the loop bounds, not a check on the
  // element, are what say an index is inside the array.
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("equal", a[i]!);
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      push("delete", a[i]!);
      i += 1;
    } else {
      push("insert", b[j]!);
      j += 1;
    }
  }

  while (i < a.length) {
    push("delete", a[i]!);
    i += 1;
  }
  while (j < b.length) {
    push("insert", b[j]!);
    j += 1;
  }

  return runs;
}
