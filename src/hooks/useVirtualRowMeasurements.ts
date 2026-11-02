import { useCallback, useLayoutEffect, useRef, type MutableRefObject } from 'react';

type Row = { key: string; type: 'message' | 'header' };
type Measurement = { key: string; estimatedHeight: number };

/** Keep one observer for the visible row window. Scrolling only measures new
 * nodes; observer notifications measure the rows whose content actually grew. */
export default function useVirtualRowMeasurements({
  rows, nodes, heightCache, messageHeight, headerHeight, contextKey, version, onHeightsChanged,
}: {
  rows: readonly Row[];
  nodes: MutableRefObject<Map<string, HTMLElement | null>>;
  heightCache: MutableRefObject<Map<string, number>>;
  messageHeight: number;
  headerHeight: number;
  contextKey: string;
  version: number;
  onHeightsChanged: () => void;
}) {
  const observed = useRef(new Map<Element, Measurement>());
  const observerRef = useRef<ResizeObserver | null>(null);
  const contextRef = useRef({ contextKey, version, messageHeight, headerHeight });

  const measure = useCallback((targets: Iterable<Element>) => {
    let changed = false;
    for (const target of targets) {
      const row = observed.current.get(target);
      if (!row) continue;
      const height = Math.ceil(target.getBoundingClientRect().height);
      if (height <= 0) continue;
      const previous = heightCache.current.get(row.key) ?? row.estimatedHeight;
      if (height === previous) continue;
      if (height === row.estimatedHeight) heightCache.current.delete(row.key);
      else heightCache.current.set(row.key, height);
      changed = true;
    }
    if (changed) onHeightsChanged();
  }, [heightCache, onHeightsChanged]);

  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    let active = true;
    const observer = new ResizeObserver((entries) => {
      if (active) measure(entries.map((entry) => entry.target));
    });
    observerRef.current = observer;
    return () => {
      active = false;
      observer.disconnect();
      observerRef.current = null;
      observed.current.clear();
    };
  }, [measure]);

  useLayoutEffect(() => {
    const observer = observerRef.current;
    const previousContext = contextRef.current;
    const measureAll = !observer || previousContext.contextKey !== contextKey || previousContext.version !== version
      || previousContext.messageHeight !== messageHeight || previousContext.headerHeight !== headerHeight;
    contextRef.current = { contextKey, version, messageHeight, headerHeight };
    const nextTargets = new Set<Element>();
    const newTargets: Element[] = [];
    const toMeasure: Element[] = [];
    for (const row of rows) {
      const wrapper = nodes.current.get(row.key);
      if (!wrapper) continue;
      const target = row.type === 'message' ? wrapper.firstElementChild ?? wrapper : wrapper;
      const previous = observed.current.get(target);
      if (!previous) newTargets.push(target);
      if (!previous || previous.key !== row.key || measureAll) toMeasure.push(target);
      observed.current.set(target, { key: row.key, estimatedHeight: row.type === 'message' ? messageHeight : headerHeight });
      nextTargets.add(target);
    }
    for (const target of observed.current.keys()) {
      if (nextTargets.has(target)) continue;
      observer?.unobserve(target);
      observed.current.delete(target);
    }
    measure(toMeasure);
    for (const target of newTargets) observer?.observe(target);
  }, [rows, nodes, messageHeight, headerHeight, contextKey, version, measure]);
}
