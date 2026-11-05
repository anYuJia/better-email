import type { MouseEvent, PointerEvent } from 'react';
import { APP_LAYOUT_BOUNDS } from '../hooks/useAppLayout';

export default function PaneResizer({ pane, width, onAdjust, onReset, onPointerDown, onMouseDown }: {
  pane: 'sidebar' | 'list'; width: number;
  onAdjust: (pane: 'sidebar' | 'list', delta: number) => void;
  onReset: (pane: 'sidebar' | 'list') => void;
  onPointerDown: (pane: 'sidebar' | 'list', event: PointerEvent<HTMLButtonElement>) => void;
  onMouseDown: (pane: 'sidebar' | 'list', event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const label = pane === 'sidebar' ? '侧边栏' : '邮件列表';
  return <button className={`pane-resizer ${pane}-resizer`} type="button" role="separator"
    aria-orientation="vertical" aria-label={`调整${label}宽度`} title={`拖拽调整${label}宽度`}
    aria-valuemin={APP_LAYOUT_BOUNDS[pane].min} aria-valuemax={APP_LAYOUT_BOUNDS[pane].max}
    aria-valuenow={width} aria-valuetext={`${width} 像素`}
    onKeyDown={(event) => {
      if (event.key === 'Home') { event.preventDefault(); onReset(pane); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        onAdjust(pane, (event.shiftKey ? 24 : 8) * (event.key === 'ArrowRight' ? 1 : -1));
      }
    }} onDoubleClick={() => onReset(pane)}
    onPointerDown={(event) => onPointerDown(pane, event)} onMouseDown={(event) => onMouseDown(pane, event)} />;
}
