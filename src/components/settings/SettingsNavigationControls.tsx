import {
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

    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('settings-search-hit');
    window.setTimeout(() => target.classList.remove('settings-search-hit'), 1200);
  }, 80);
}

function requiresAccount(section: SettingsSectionId) {
  return section !== 'accounts' && accountScopedSections.has(section);
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
    onNavigate(entry.section);
    setQuery('');
    focusSearchTarget(entry);
  };

  return (
    <nav className="settings-nav" aria-label="设置分类">
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
                  const active = resolvedActiveSection === item.id;
                  const disabled = requiresAccount(item.id) && !accountSectionsEnabled;
                  return (
                    <button
                      type="button"
                      className={active ? 'active' : ''}
                      key={item.id}
                      aria-current={active ? 'page' : undefined}
                      aria-label={`${item.label}设置`}
                      disabled={disabled}
                      title={disabled ? '请先添加或选择邮箱账号' : item.description}
                      onClick={() => onNavigate(item.id)}
                    >
                      <span className="settings-nav-icon">
                        <Icon size={15} aria-hidden="true" />
                      </span>
                      <span className="settings-nav-copy">
                        <span className="settings-nav-label">{item.label}</span>
                      </span>
                    </button>
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
