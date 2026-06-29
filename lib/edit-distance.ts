/**
 * Character-level Levenshtein distance — the minimum number of single-char
 * insertions, deletions, or substitutions to transform `a` into `b`.
 *
 * Used by `updateOutputContent` to accumulate the user's edit volume on a
 * `GeneratedOutput`. Inputs are platform outputs (≤ ~5 KB typically), so the
 * O(n·m) classical algorithm is plenty fast — single edits stay sub-30 ms
 * even on the longest blog drafts.
 *
 * Memory: we keep two rows (current + previous) instead of the full DP
 * matrix, so memory is O(min(n, m)).
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure `a` is the shorter string so we keep memory minimal.
  if (a.length > b.length) [a, b] = [b, a];

  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(m + 1);
  let curr = new Array<number>(m + 1);

  for (let i = 0; i <= m; i++) prev[i] = i;

  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    const bj = b.charCodeAt(j - 1);
    for (let i = 1; i <= m; i++) {
      const cost = a.charCodeAt(i - 1) === bj ? 0 : 1;
      // Math.min on three numbers is faster than spread in a hot loop.
      const del = prev[i] + 1;
      const ins = curr[i - 1] + 1;
      const sub = prev[i - 1] + cost;
      curr[i] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m];
}
