export type LayoutItem = { top: number; height: number };

export function calculateVisibleRange(
  layout: LayoutItem[],
  scrollTop: number,
  viewportHeight: number
) {
  if (layout.length === 0) {
    return { startIdx: 0, endIdx: 0 };
  }

  let low = 0;
  let high = layout.length - 1;
  let index = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (layout[mid].top + layout[mid].height >= scrollTop - 200) {
      index = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  const startIdx = Math.max(0, index);

  low = startIdx;
  high = layout.length - 1;
  let endIndex = layout.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (layout[mid].top <= scrollTop + viewportHeight + 200) {
      endIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const endIdx = Math.min(layout.length - 1, endIndex);

  return { startIdx, endIdx };
}
