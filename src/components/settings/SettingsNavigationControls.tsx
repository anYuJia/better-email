import {
  ChevronDown,
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
  resolveSettingsNavigationSectionId,
  settingsNavigationGroups,
  settingsNavigationItems,
  settingsSearchEntries,
  type SettingsNavigationItem,
  type SettingsSearchEntry,
  type SettingsSectionId,
} from './settingsNavigation';

type SettingsNavigationProps = {
  activeSection: SettingsSectionId;
  activeItem: SettingsNavigationItem;
  onNavigate: (section: SettingsSectionId) => void;
};

function focusSearchTarget(entry: SettingsSearchEntry) {
  window.setTimeout(() => {
    const target = entry.target
      ? document.querySelector<HTMLElement>(`[data-settings-section="${entry.target}"]`)
      : document.querySelector<HTMLElement>(`[data-settings-page="${entry.section}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('settings-search-hit');
    window.setTimeout(() => target.classList.remove('settings-search-hit'), 1200);
  }, 80);
}

export const SettingsSidebar = memo(function SettingsSidebar({
  activeSection,
  onNavigate,
}: Omit<SettingsNavigationProps, 'activeItem'>) {
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
            {searchResults.map((entry) => (
              <button
                type="button"
                className="settings-search-result"
                key={`${entry.section}-${entry.label}`}
                onClick={() => navigateToSearchResult(entry)}
              >
                <strong>{entry.label}</strong>
                <small>{entry.path}</small>
              </button>
            ))}
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
            {settingsNavigationItems.map((item) => {
              const Icon = item.icon;
              const active = resolvedActiveSection === item.id;
              return (
                <button
                  type="button"
                  className={active ? 'active' : ''}
                  key={item.id}
                  aria-current={active ? 'page' : undefined}
                  aria-label={`${item.label}设置`}
                  onClick={() => onNavigate(item.id)}
                >
                  <span className="settings-nav-icon">
                    <Icon size={15} />
                  </span>
                  <span className="settings-nav-copy">
                    <span className="settings-nav-label">{item.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
});

export const SettingsMobileNavigation = memo(function SettingsMobileNavigation({
  activeSection,
  activeItem,
  onNavigate,
}: SettingsNavigationProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLButtonElement>(null);
  const ActiveIcon = activeItem.icon;
  const resolvedActiveSection = resolveSettingsNavigationSectionId(activeSection);

  useEffect(() => {
    if (!open) return undefined;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      queueMicrotask(() => pickerRef.current?.focus({ preventScroll: true }));
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="settings-mobile-toolbar" ref={containerRef}>
      <button
        ref={pickerRef}
        type="button"
        className="settings-page-picker"
        aria-label="切换设置页面"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="settings-page-picker-icon" aria-hidden="true">
          <ActiveIcon size={16} />
        </span>
        <span className="settings-page-picker-copy">
          <strong>{activeItem.label}</strong>
        </span>
        <ChevronDown
          className={open ? 'open' : ''}
          size={16}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="settings-mobile-menu" role="menu" aria-label="设置页面">
          {settingsNavigationGroups.map((group) => (
            <div className="settings-mobile-menu-group" key={group.label}>
              <span>{group.label}</span>
              {group.items.map((item) => (
                <button
                  type="button"
                  role="menuitem"
                  className={item.id === resolvedActiveSection ? 'active' : ''}
                  key={item.id}
                  onClick={() => {
                    onNavigate(item.id);
                    setOpen(false);
                  }}
                >
                  <item.icon size={15} aria-hidden="true" />
                  <span>
                    <strong>{item.label}</strong>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
