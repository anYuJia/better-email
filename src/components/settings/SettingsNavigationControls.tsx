import {
  ChevronRight,
  Search,
  X,
} from 'lucide-react';
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  accountScopedSections,
  getSettingsDetailItems,
  resolveSettingsNavigationSectionId,
  settingsNavigationGroups,
  settingsSearchEntries,
  type SettingsSearchEntry,
  type SettingsSectionId,
} from './settingsNavigation';

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

    const closestAnimatedDisclosure = target.closest<HTMLElement>('.settings-animated-disclosure');
    const animatedDisclosures = new Set<HTMLElement>([
      ...(target.matches('.settings-animated-disclosure') ? [target] : []),
      ...Array.from(target.querySelectorAll<HTMLElement>('.settings-animated-disclosure')),
      ...(closestAnimatedDisclosure ? [closestAnimatedDisclosure] : []),
    ]);
    animatedDisclosures.forEach((disclosure) => {
      const trigger = disclosure.querySelector<HTMLButtonElement>(
        ':scope > .settings-animated-disclosure-trigger',
      );
      if (trigger?.getAttribute('aria-expanded') === 'false') trigger.click();
    });

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

function exposesAvailableDetails(
  section: SettingsSectionId,
  accountSectionsEnabled: boolean,
) {
  return getSettingsDetailItems(section).length > 0
    && (section !== 'accounts' || accountSectionsEnabled);
}

export const SettingsSidebar = memo(function SettingsSidebar({
  activeSection,
  onNavigate,
  accountSectionsEnabled = true,
}: SettingsSidebarProps) {
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const resolvedActiveSection = resolveSettingsNavigationSectionId(activeSection);
  const manuallyCollapsedSectionsRef = useRef<Set<SettingsSectionId>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<SettingsSectionId>>(
    () => new Set(),
  );
  useEffect(() => {
    setExpandedSections((currentSections) => {
      const nextSections = new Set(currentSections);
      let changed = false;

      if (!accountSectionsEnabled) {
        manuallyCollapsedSectionsRef.current.delete('accounts');
        if (nextSections.delete('accounts')) changed = true;
      }

      const activeSectionIsNested = activeSection !== resolvedActiveSection;
      if (activeSectionIsNested) {
        manuallyCollapsedSectionsRef.current.delete(resolvedActiveSection);
      }

      if (
        activeSectionIsNested
        && exposesAvailableDetails(resolvedActiveSection, accountSectionsEnabled)
        && !manuallyCollapsedSectionsRef.current.has(resolvedActiveSection)
        && !nextSections.has(resolvedActiveSection)
      ) {
        nextSections.add(resolvedActiveSection);
        changed = true;
      }

      return changed ? nextSections : currentSections;
    });
  }, [accountSectionsEnabled, activeSection, resolvedActiveSection]);

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const searchResults = useMemo(() => {
    if (!normalizedQuery) return [];
    return settingsSearchEntries.filter((entry) => (
      `${entry.label} ${entry.path} ${entry.keywords.join(' ')}`
        .toLowerCase()
        .includes(normalizedQuery)
    )).slice(0, 10);
  }, [normalizedQuery]);

  const navigateToSearchResult = (entry: SettingsSearchEntry) => {
    if (requiresAccount(entry.section) && !accountSectionsEnabled) return;
    const parentSection = resolveSettingsNavigationSectionId(entry.section);
    if (exposesAvailableDetails(parentSection, accountSectionsEnabled)) {
      manuallyCollapsedSectionsRef.current.delete(parentSection);
      setExpandedSections((currentSections) => {
        if (currentSections.has(parentSection)) return currentSections;
        const nextSections = new Set(currentSections);
        nextSections.add(parentSection);
        return nextSections;
      });
    }
    onNavigate(entry.section);
    setQuery('');
    focusSearchTarget(entry);
  };

  return (
    <nav
      className="settings-nav"
      aria-label="设置分类"
    >
      <div className="settings-nav-search" role="search">
        <Search size={14} aria-hidden="true" />
        <input
          ref={searchInputRef}
          type="search"
          aria-label="搜索设置"
          value={query}
          placeholder="搜索设置"
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        {query ? (
          <button
            type="button"
            aria-label="清空设置搜索"
            title="清空搜索"
            onClick={() => setQuery('')}
          >
            <X size={13} />
          </button>
        ) : (
          <kbd className="settings-search-shortcut">⌘F</kbd>
        )}
      </div>

      <div className="settings-nav-scroll">
        {normalizedQuery ? (
          <div className="settings-search-results" aria-label="设置搜索结果">
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
                  onClick={() => setQuery('')}
                >
                  清除搜索
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="settings-nav-list">
            {settingsNavigationGroups.map((group) => (
              <section className="settings-nav-section" key={group.label} aria-label={group.label}>
                <span className="settings-nav-group">{group.label}</span>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeSection === item.id;
                  const contextActive = resolvedActiveSection === item.id;
                  const detailItems = getSettingsDetailItems(item.id);
                  const exposesDetailItems = detailItems.length > 0
                    && (item.id !== 'accounts' || accountSectionsEnabled);
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

                    if (activeSection !== item.id) {
                      onNavigate(item.id);
                    }
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
                          <Icon size={15} aria-hidden="true" />
                        </span>
                        <span className="settings-nav-copy">
                          <span className="settings-nav-label">{item.label}</span>
                        </span>
                        {exposesDetailItems && (
                          <ChevronRight className="settings-nav-disclosure" size={14} aria-hidden="true" />
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
        )}
      </div>
    </nav>
  );
});
