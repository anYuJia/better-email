import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, useState } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import GlobalSearch, { type GlobalSearchProps } from './GlobalSearch';

const globalStyles = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../styles/global.css'), 'utf8');

afterEach(() => { cleanup(); vi.useRealTimers(); });

function SearchHarness(props: Partial<GlobalSearchProps> = {}) {
  const [query, setQuery] = useState('季度报告');
  return <GlobalSearch
    searchInputRef={null} query={query} appliedQuery="" searchScope="folder" filter="all"
    messages={[]} shortcutLabel="⌘ K" onSearchSubmit={(event) => event.preventDefault()}
    onQueryChange={setQuery} onSearchScopeChange={vi.fn()}
    onClearSearchAndFilter={() => setQuery('')} onApplySearchShortcut={setQuery} {...props}
  />;
}

describe('GlobalSearch keyboard and focus continuity', () => {
  it('keeps Home/End available for text editing until suggestion navigation starts', () => {
    render(<SearchHarness />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    expect(fireEvent.keyDown(input, { key: 'Home' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'End' })).toBe(true);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    fireEvent.mouseEnter(screen.getByRole('option', { name: '发件人' }));
    expect(fireEvent.keyDown(input, { key: 'Home' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'End' })).toBe(true);
    fireEvent.change(input, { target: { value: '年度报告' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { selected: true }).textContent).toBe('全部');
    fireEvent.keyDown(input, { key: 'End' });
    expect(screen.getByRole('option', { selected: true }).textContent).toBe('星标');
    expect(document.querySelectorAll('.search-suggestion-panel .active')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((input as HTMLInputElement).value).toBe('is:starred 年度报告');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('clears stale selection semantics when the list closes on submit or blur', () => {
    vi.useFakeTimers();
    render(<SearchHarness />);
    const input = screen.getByRole('combobox');
    for (const dismiss of ['submit', 'blur']) {
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(input.hasAttribute('aria-activedescendant')).toBe(true);
      if (dismiss === 'submit') fireEvent.submit(screen.getByRole('search'));
      else { fireEvent.blur(input); act(() => vi.advanceTimersByTime(120)); }
      expect(screen.queryByRole('listbox')).toBeNull();
      expect(input.getAttribute('aria-expanded')).toBe('false');
      expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    }
  });

  it('returns focus to the input after clearing, with object and callback refs', () => {
    const objectRef = createRef<HTMLInputElement>();
    const callbackRef = vi.fn();
    for (const searchInputRef of [objectRef, callbackRef]) {
      const view = render(<SearchHarness searchInputRef={searchInputRef} />);
      const input = screen.getByRole('combobox');
      const clear = screen.getByRole('button', { name: '清空搜索和筛选' });
      clear.focus();
      fireEvent.click(clear);
      expect(document.activeElement).toBe(input);
      expect((input as HTMLInputElement).value).toBe('');
      expect(screen.queryByRole('button', { name: '清空搜索和筛选' })).toBeNull();
      if (searchInputRef === objectRef) expect(objectRef.current).toBe(input);
      else expect(callbackRef).toHaveBeenCalledWith(input);
      view.unmount();
    }
    expect(objectRef.current).toBeNull();
    expect(callbackRef).toHaveBeenLastCalledWith(null);
  });

  it('does not intercept suggestion keys during Chinese composition or show partial counts as search totals', () => {
    render(<SearchHarness />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.compositionStart(input);
    for (const key of ['ArrowDown', 'Enter', 'Escape']) expect(fireEvent.keyDown(input, { key })).toBe(true);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(screen.getByRole('listbox').textContent).toContain('搜索方式');
    expect(screen.getByRole('listbox').textContent).not.toContain('0 封');
  });
});

describe('GlobalSearch cold-start accessibility styles', () => {
  it('keeps the search scope description out of the layout before any composer is loaded', () => {
    const style = document.createElement('style');
    style.textContent = globalStyles;
    document.head.append(style);
    try {
      render(<GlobalSearch
        searchInputRef={null}
        query=""
        appliedQuery=""
        searchScope="folder"
        filter="all"
        messages={[]}
        shortcutLabel="⌘ K"
        onSearchSubmit={vi.fn()}
        onQueryChange={vi.fn()}
        onSearchScopeChange={vi.fn()}
        onClearSearchAndFilter={vi.fn()}
        onApplySearchShortcut={vi.fn()}
      />);
      const input = screen.getByRole('combobox');
      const description = document.getElementById(input.getAttribute('aria-describedby') ?? '') as HTMLElement;
      expect(description.textContent).toContain('仅搜索已同步到本机的邮件');
      const computed = window.getComputedStyle(description);
      expect(computed.position).toBe('absolute');
      expect(computed.width).toBe('1px');
      expect(computed.height).toBe('1px');
      expect(computed.overflow).toBe('hidden');
    } finally {
      style.remove();
    }
  });
});
