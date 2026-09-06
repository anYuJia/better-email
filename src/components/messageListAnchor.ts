type KeyedRow = { key: string };
type RowLayout = { top: number; height: number };

export function anchoredScrollTop(
  previousRows: readonly KeyedRow[],
  previousLayout: readonly RowLayout[],
  nextRows: readonly KeyedRow[],
  nextLayout: readonly RowLayout[],
  scrollTop: number,
): number {
  if (scrollTop <= 0 || previousRows.length !== previousLayout.length || !previousRows.length) return scrollTop;
  let low = 0;
  let high = previousLayout.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (previousLayout[middle].top <= scrollTop) low = middle;
    else high = middle - 1;
  }
  const newIndexes = new Map(nextRows.map((row, index) => [row.key, index]));
  for (let index = low; index < previousRows.length; index += 1) {
    const next = newIndexes.get(previousRows[index].key);
    if (next !== undefined && nextLayout[next]) {
      return Math.max(0, nextLayout[next].top + scrollTop - previousLayout[index].top);
    }
  }
  return scrollTop;
}
