export type LayoutItem = { top: number; height: number };

/**
 * 邮件列表虚拟布局的行高常量 —— 单一事实来源。
 *
 * 与 `styles/message-list.css` 中 `.message-list-item` 的 `height: 64px`
 * 以及 `.message-date-header` 的 `height: 30px` 保持严格一致：
 * 每封邮件是一行连续列表（无卡片间隙），日期分组标题固定 30px。
 * 虚拟计算高度必须与实际渲染高度一致，否则滚动、选中、悬停会错位。
 */
export const MESSAGE_ROW_HEIGHT = 64;
export const GROUP_HEADER_HEIGHT = 30;
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
