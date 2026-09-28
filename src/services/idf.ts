/**
 * How much a shared thing says, by how many things share it.
 *
 * The file filter weighs a query word by how many files hold it, and the
 * related-notes ranking weighs a shared link or tag by how many notes carry
 * it. Both answer the same question, and two copies of the formula were two
 * places for it to drift apart; this is the one.
 *
 * Smoothed inverse document frequency: a thing in every document still
 * contributes a small baseline rather than dropping to nothing, and a thing
 * in one document dominates. The same formula scikit-learn uses for
 * `smooth_idf`.
 */
export function idf(documentFrequency: number, total: number): number {
  return Math.log((total + 1) / (Math.max(0, documentFrequency) + 1)) + 1;
}
