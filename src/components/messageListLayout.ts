export type LayoutItem = { top: number; height: number };

/**
 * 邮件列表虚拟布局的初始行高估计与最小高度。
 *
 * 标准桌面邮件行保持 76px，紧凑模式使用 68px；放大文字后由内容自然增高，ResizeObserver
 * 测量实际高度更新虚拟位置与滚动锚点。日期分组标题固定 30px。
 */
export const MESSAGE_ROW_HEIGHT = 76;
export const COMPACT_MESSAGE_ROW_HEIGHT = 68;
/** Mobile keeps a comfortable touch target with mature typography hierarchy. */
export const MOBILE_MESSAGE_ROW_HEIGHT = 80;
export const GROUP_HEADER_HEIGHT = 30;
/** A date-group selection target occupies a full touch row on mobile. */
export const MOBILE_GROUP_HEADER_HEIGHT = 44;
/** 列表底部“已显示 N 封 / 加载更多”区域的高度，计入外层包裹总高度。 */
export const LIST_FOOTER_HEIGHT = 40;

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

// The mounted window includes overscan. Its boundaries can stay fixed while
// the first or last row on screen changes during a small scroll gesture.
export function calculateMessageWindow(layout: LayoutItem[], scrollTop: number, viewportHeight: number) {
  const { startIdx, endIdx } = calculateVisibleRange(layout, scrollTop, viewportHeight);
  let firstOnscreen = startIdx;
  let lastOnscreen = Math.min(endIdx, layout.length - 1);
  while (firstOnscreen <= lastOnscreen && layout[firstOnscreen].top + layout[firstOnscreen].height <= scrollTop) {
    firstOnscreen++;
  }
  while (lastOnscreen >= firstOnscreen && layout[lastOnscreen].top >= scrollTop + viewportHeight) {
    lastOnscreen--;
  }
  return { startIdx, endIdx, firstOnscreen, lastOnscreen };
}
