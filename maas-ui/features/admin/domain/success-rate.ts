// Shared by summary cards so small nonzero rates are not rounded to integers.
export function formatSuccessRate(rate: number) {
  return rate.toFixed(rate >= 99 ? 1 : 2);
}
