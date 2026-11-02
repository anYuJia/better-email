import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

type EditingSession = {
  target: HTMLElement;
  textSelection: { start: number; end: number; direction: 'forward' | 'backward' | 'none' } | null;
  range: Range | null;
  anchor: { node: Node; offset: number } | null;
  focus: { node: Node; offset: number } | null;
  scroll: Array<{ element: HTMLElement; top: number; left: number }>;
};

/** Keep the editing location separate from the minimize/restore button focus.
 * The DOM itself stays mounted, preserving the browser's native undo history. */
export default function useComposerEditingSession(panelRef: RefObject<HTMLElement>, active: boolean) {
  const saved = useRef<EditingSession | null>(null);
  const restoring = useRef(!active);
  useLayoutEffect(() => {
    if (!active) restoring.current = true;
  }, [active]);

  const capture = useCallback((candidate?: EventTarget | null) => {
    // A mobile modal also establishes its initial focus on restore. Do not let
    // that intermediate focus overwrite the user's saved editing position.
    if (candidate && restoring.current) return;
    const panel = panelRef.current;
    const active = candidate ?? document.activeElement;
    const isEditor = (element: unknown): element is HTMLElement => element instanceof HTMLElement
      && Boolean(panel?.contains(element))
      && Boolean(element.closest('.composer-primary-fields'))
      && element.matches('input:not([type="hidden"]), textarea, [contenteditable="true"]');
    const target = isEditor(active) ? active : saved.current?.target;
    if (!target || !panel?.contains(target)) return;
    const previous = saved.current?.target === target ? saved.current : null;
    const selection = target.ownerDocument.getSelection();
    const ownsSelection = selection?.anchorNode && selection.focusNode
      && target.contains(selection.anchorNode) && target.contains(selection.focusNode);
    const scroll: EditingSession['scroll'] = [];
    for (let element: HTMLElement | null = target; element && panel.contains(element); element = element.parentElement) {
      scroll.push({ element, top: element.scrollTop, left: element.scrollLeft });
    }
    saved.current = {
      target,
      textSelection: target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        ? target.selectionStart === null || target.selectionEnd === null ? null : {
          start: target.selectionStart, end: target.selectionEnd, direction: target.selectionDirection ?? 'none',
        } : null,
      range: ownsSelection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : previous?.range ?? null,
      anchor: ownsSelection ? { node: selection.anchorNode!, offset: selection.anchorOffset } : previous?.anchor ?? null,
      focus: ownsSelection ? { node: selection.focusNode!, offset: selection.focusOffset } : previous?.focus ?? null,
      scroll,
    };
  }, [panelRef]);

  const restore = useCallback(() => {
    const snapshot = saved.current;
    restoring.current = false;
    if (!snapshot || !panelRef.current?.contains(snapshot.target)
      || snapshot.target.closest('[inert], [hidden]') || snapshot.target.hasAttribute('disabled')) return false;
    const { target, textSelection, range, anchor, focus, scroll } = snapshot;
    target.focus({ preventScroll: true });
    if (textSelection && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      target.setSelectionRange(textSelection.start, textSelection.end, textSelection.direction);
    } else if (range && target.contains(range.commonAncestorContainer)) {
      const selection = target.ownerDocument.getSelection();
      const validOffset = (point: { node: Node; offset: number }) => point.offset <= (
        point.node.nodeType === Node.TEXT_NODE ? point.node.textContent?.length ?? 0 : point.node.childNodes.length
      );
      if (anchor && focus && target.contains(anchor.node) && target.contains(focus.node)
        && validOffset(anchor) && validOffset(focus) && selection?.setBaseAndExtent) {
        selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
      } else {
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
    for (const item of scroll) {
      item.element.scrollTop = item.top;
      item.element.scrollLeft = item.left;
    }
    saved.current = snapshot;
    return document.activeElement === target;
  }, [panelRef]);

  return { capture, restore };
}
