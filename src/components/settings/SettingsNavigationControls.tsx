import {
  ChevronRight,
  Search,
  X,
} from 'lucide-react';
import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useWheelContainment } from '../../hooks/useWheelContainment';
import useCompositionGuard from '../../hooks/useCompositionGuard';
import {
  accountScopedSections,
  getSettingsDetailItems,
  resolveSettingsNavigationSectionId,
  settingsNavigationGroups,
  settingsSearchEntries,
  type SettingsSearchEntry,
  type SettingsSectionId,
} from './settingsNavigation';

type SettingsSearchProps = {
  onNavigate: (section: SettingsSectionId) => void;
  accountSectionsEnabled?: boolean;
  mobile: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};

type SettingsSidebarProps = {
  activeSection: SettingsSectionId;
  onNavigate: (section: SettingsSectionId) => void;
  accountSectionsEnabled?: boolean;
};

function focusSearchTarget(entry: SettingsSearchEntry) {
  window.setTimeout(() => {
    const target = entry.target
      ? document.querySelector<HTMLElement>(`[data-settings-section="${entry.target}"]`)
      : document.querySelector<HTMLElement>(`[data-settings-page="${entry.section}"]`);
    if (!target) return;

    const disclosures = [
      ...(target instanceof HTMLDetailsElement ? [target] : []),
      ...Array.from(target.querySelectorAll<HTMLDetailsElement>('details')),
    ];
    let ancestor = target.parentElement;
    while (ancestor) {
      if (ancestor instanceof HTMLDetailsElement) disclosures.push(ancestor);
      ancestor = ancestor.parentElement;
    }
    disclosures.forEach((details) => { details.open = true; });

    const prefersReducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({
      block: 'center',
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
    target.classList.remove('settings-search-hit');
    void target.offsetWidth;
    target.classList.add('settings-search-hit');
    window.setTimeout(() => target.classList.remove('settings-search-hit'), 650);
  }, 80);
}

function requiresAccount(section: SettingsSectionId) {
  return section !== 'accounts' && accountScopedSections.has(section);
}

function exposesAvailableDetails(section: SettingsSectionId) {
  return getSettingsDetailItems(section).length > 0;
}

/** Header search shared by desktop and mobile Settings. */
export const SettingsSearch = memo(function SettingsSearch({
  onNavigate,
  accountSectionsEnabled = true,
  mobile,
  expanded,
  onExpandedChange,
}: SettingsSearchProps) {
  const [query, setQuery] = useState('');
  const ime = useCompositionGuard();
  const resultId = useId();
  const searchRootRef = useRef<HTMLDivElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const previousExpandedRef = useRef(false);
  const restoreFocusRef = useRef(true);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchPopoverRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim().toLowerCase();
  useWheelContainment(searchPopoverRef, Boolean(normalizedQuery));
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return [];
    return settingsSearchEntries.filter((entry) => (
      `${entry.label} ${entry.path} ${entry.keywords.join(' ')}`
        .toLowerCase()
        .includes(normalizedQuery)
    )).slice(0, 10);
  }, [normalizedQuery]);

  useLayoutEffect(() => {
    if (mobile && expanded) {
      searchInputRef.current?.focus({ preventScroll: true });
      searchInputRef.current?.select();
    } else if (previousExpandedRef.current) {
      setQuery('');
      if (restoreFocusRef.current) searchToggleRef.current?.focus({ preventScroll: true });
      restoreFocusRef.current = true;
    }
    previousExpandedRef.current = expanded;
  }, [expanded, mobile]);

  const closeSearch = (restoreFocus = true) => {
    restoreFocusRef.current = restoreFocus;
    setQuery('');
    onExpandedChange(false);
  };

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        if (event.defaultPrevented || event.isComposing) return;
        event.preventDefault();
        if (mobile) onExpandedChange(true);
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [mobile, onExpandedChange]);

  useEffect(() => {
    if (!expanded && !normalizedQuery) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !searchRootRef.current?.contains(event.target)) {
        restoreFocusRef.current = false;
        setQuery('');
        onExpandedChange(false);
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [expanded, normalizedQuery, onExpandedChange]);

  const navigateToSearchResult = (entry: SettingsSearchEntry) => {
    if (requiresAccount(entry.section) && !accountSectionsEnabled) return;
    onNavigate(entry.section);
    closeSearch(false);
    focusSearchTarget(entry);
  };

  return (
    <div
      ref={searchRootRef}
      className={`settings-header-search${mobile && expanded ? ' is-mobile-expanded' : ''}`}
      role="search"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        if (ime.isComposing(event)) { event.stopPropagation(); return; }
        if (!expanded && !query) return;
        event.preventDefault();
        event.stopPropagation();
        closeSearch();
        if (!mobile) searchInputRef.current?.focus();
      }}
    >
      {mobile && !expanded && <button
        ref={searchToggleRef}
        type="button"
        className="settings-search-toggle"
        aria-label="打开设置搜索"
        title="搜索设置"
        onClick={() => {
          onExpandedChange(true);
        }}
      >
        <Search size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>}
      {(!mobile || expanded) && <div className="settings-search-field">
        <Search size={16} strokeWidth={1.75} aria-hidden="true" />
        <input
          ref={searchInputRef}
          type="search"
          aria-label="搜索设置"
          aria-autocomplete="list"
          aria-expanded={Boolean(normalizedQuery)}
          aria-controls={normalizedQuery ? resultId : undefined}
          value={query}
          placeholder="搜索设置"
          onInput={(event) => setQuery(event.currentTarget.value)}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && !ime.isComposing(event)) {
              const firstResult = searchPopoverRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
              if (firstResult) { event.preventDefault(); firstResult.focus(); }
            }
          }}
        />
        {query ? (
          <button
            type="button"
            aria-label="清空设置搜索"
            title="清空搜索"
            onClick={() => {
              setQuery('');
              searchInputRef.current?.focus();
            }}
          >
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : (
          <kbd className="settings-search-shortcut">⌘F</kbd>
        )}
      </div>}
      {mobile && expanded && (
        <button type="button" className="settings-search-cancel" onClick={() => closeSearch()} aria-label="取消设置搜索">
          取消
        </button>
      )}
      {normalizedQuery && (
        <div
          ref={searchPopoverRef}
          id={resultId}
          className="settings-search-popover"
          aria-label="设置搜索结果"
        >
          <span className="settings-nav-match-count">
            {searchResults.length > 0 ? `${searchResults.length} 个匹配` : '没有匹配'}
          </span>
          {searchResults.map((entry) => {
            const disabled = requiresAccount(entry.section) && !accountSectionsEnabled;
            return (
              <button
                type="button"
                className="settings-search-result"
                key={`${entry.section}-${entry.label}`}
                disabled={disabled}
                title={disabled ? '请先添加或选择邮箱账号' : undefined}
                onClick={() => navigateToSearchResult(entry)}
              >
                <strong>{entry.label}</strong>
                <small>{entry.path}</small>
              </button>
            );
          })}
          {searchResults.length === 0 && (
            <div className="settings-nav-empty">
              <strong>没有找到这个设置</strong>
              <span>试试“附件”“撤销发送”或“免打扰”</span>
              <button
                type="button"
                className="st-btn st-btn-secondary st-btn-sm"
                onClick={() => {
                  setQuery('');
                  searchInputRef.current?.focus();
                }}
              >
                清除搜索
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export const SettingsSidebar = memo(function SettingsSidebar({
  activeSection,
  onNavigate,
  accountSectionsEnabled = true,
}: SettingsSidebarProps) {
  const resolvedActiveSection = resolveSettingsNavigationSectionId(activeSection);
  const manuallyCollapsedSectionsRef = useRef<Set<SettingsSectionId>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<SettingsSectionId>>(
    () => new Set(),
  );

  useEffect(() => {
    setExpandedSections((currentSections) => {
      const nextSections = new Set(currentSections);
      let changed = false;
      const activeSectionIsNested = activeSection !== resolvedActiveSection;
      if (activeSectionIsNested) {
        manuallyCollapsedSectionsRef.current.delete(resolvedActiveSection);
      }
      if (
        activeSectionIsNested
        && exposesAvailableDetails(resolvedActiveSection)
        && !manuallyCollapsedSectionsRef.current.has(resolvedActiveSection)
        && !nextSections.has(resolvedActiveSection)
      ) {
        nextSections.add(resolvedActiveSection);
        changed = true;
      }
      return changed ? nextSections : currentSections;
    });
  }, [activeSection, resolvedActiveSection]);

  return (
    <nav className="settings-nav" aria-label="设置分类">
      <h1 className="settings-nav-heading">设置</h1>
      <div className="settings-nav-scroll">
        <div className="settings-nav-list">
          {settingsNavigationGroups.map((group) => (
            <section className="settings-nav-section" key={group.label} aria-label={group.label}>
              <span className="settings-nav-group">{group.label}</span>
              {group.items.map((item) => {
                const Icon = item.icon;
                const detailItems = getSettingsDetailItems(item.id);
                const exposesDetailItems = detailItems.length > 0;
                const active = !exposesDetailItems && activeSection === item.id;
                const contextActive = resolvedActiveSection === item.id;
                const showDetailItems = expandedSections.has(item.id) && exposesDetailItems;
                const detailGroupId = `settings-nav-${item.id}-details`;
                const disabled = requiresAccount(item.id) && !accountSectionsEnabled;
                const parentClassName = [
                  'settings-nav-parent',
                  active ? 'active' : '',
                  contextActive ? 'context-active' : '',
                  exposesDetailItems ? 'has-disclosure' : '',
                ].filter(Boolean).join(' ');
                const activateParent = () => {
                  if (!exposesDetailItems) {
                    onNavigate(item.id);
                    return;
                  }
                  const nextExpanded = !showDetailItems;
                  if (nextExpanded) manuallyCollapsedSectionsRef.current.delete(item.id);
                  else manuallyCollapsedSectionsRef.current.add(item.id);
                  setExpandedSections((currentSections) => {
                    const nextSections = new Set(currentSections);
                    if (nextExpanded) nextSections.add(item.id);
                    else nextSections.delete(item.id);
                    return nextSections;
                  });
                };
                return (
                  <div className="settings-nav-branch" key={item.id}>
                    <button
                      type="button"
                      className={parentClassName}
                      aria-current={active ? 'page' : undefined}
                      aria-expanded={exposesDetailItems ? showDetailItems : undefined}
                      aria-controls={exposesDetailItems ? detailGroupId : undefined}
                      aria-label={`${item.label}设置`}
                      disabled={disabled}
                      title={disabled
                        ? '请先添加或选择邮箱账号'
                        : exposesDetailItems
                          ? `${showDetailItems ? '收起' : '展开'}${item.label}详细设置`
                          : item.description}
                      onClick={activateParent}
                    >
                      <span className="settings-nav-icon">
                        <Icon size={18} aria-hidden="true" />
                      </span>
                      <span className="settings-nav-copy">
                        <span className="settings-nav-label">{item.label}</span>
                      </span>
                      {exposesDetailItems && (
                        <ChevronRight className="settings-nav-disclosure" size={16} aria-hidden="true" />
                      )}
                    </button>
                    {exposesDetailItems && (
                      <div
                        className={`settings-nav-subsection${showDetailItems ? ' is-open' : ''}`}
                        id={detailGroupId}
                        role="group"
                        aria-label={`${item.label}详细设置`}
                        aria-hidden={!showDetailItems}
                      >
                        <div className="settings-nav-subsection-content">
                          {detailItems.map((detailItem) => {
                            const detailActive = activeSection === detailItem.id;
                            const detailDisabled = requiresAccount(detailItem.id) && !accountSectionsEnabled;
                            return (
                              <button
                                type="button"
                                className={`settings-nav-subitem${detailActive ? ' active' : ''}`}
                                key={detailItem.id}
                                aria-current={detailActive ? 'page' : undefined}
                                aria-label={`${detailItem.label}设置`}
                                disabled={detailDisabled}
                                tabIndex={showDetailItems ? undefined : -1}
                                title={detailDisabled ? '请先添加或选择邮箱账号' : detailItem.description}
                                onClick={() => onNavigate(detailItem.id)}
                              >
                                <span className="settings-nav-subitem-label">{detailItem.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </nav>
  );
});
