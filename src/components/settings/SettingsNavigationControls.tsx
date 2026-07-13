import {
  ChevronDown,
  Search,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  settingsNavigationGroups,
  type SettingsNavigationItem,
  type SettingsSectionId,
} from './settingsNavigation';

type SettingsNavigationProps = {
  activeSection: SettingsSectionId;
  activeItem: SettingsNavigationItem;
  onNavigate: (section: SettingsSectionId) => void;
};

export function SettingsSidebar({
  activeSection,
  onNavigate,
}: Omit<SettingsNavigationProps, 'activeItem'>) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return settingsNavigationGroups;
    return settingsNavigationGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => (
          `${item.label} ${item.description}`
            .toLowerCase()
            .includes(normalizedQuery)
        )),
      }))
      .filter((group) => group.items.length > 0);
  }, [normalizedQuery]);

  return (
    <nav className="settings-nav" aria-label="设置分类">
      <div className="settings-nav-intro">
        <strong>设置</strong>
      </div>
      <div className="settings-nav-search" role="search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          aria-label="搜索设置页面"
          value={query}
          placeholder="搜索设置"
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        {query && (
          <button
            type="button"
            aria-label="清空设置搜索"
            title="清空搜索"
            onClick={() => setQuery('')}
          >
            <X size={13} />
          </button>
        )}
      </div>
      {filteredGroups.map((group) => (
        <div className="settings-nav-section" key={group.label}>
          <span className="settings-nav-group">{group.label}</span>
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                type="button"
                className={active ? 'active' : ''}
                key={item.id}
                aria-current={active ? 'page' : undefined}
                aria-label={`${item.label}设置`}
                title={item.description}
                onClick={() => onNavigate(item.id)}
              >
                <span className="settings-nav-icon">
                  <Icon size={15} />
                </span>
                <span className="settings-nav-copy">
                  <span className="settings-nav-label">{item.label}</span>
                </span>
                {active && <span className="settings-nav-active-dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      ))}
      {filteredGroups.length === 0 && (
        <div className="settings-nav-empty">
          <strong>没有匹配的设置</strong>
          <span>换一个关键词试试</span>
        </div>
      )}
    </nav>
  );
}

export function SettingsMobileNavigation({
  activeSection,
  activeItem,
  onNavigate,
}: SettingsNavigationProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const ActiveIcon = activeItem.icon;

  useEffect(() => {
    if (!open) return undefined;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="settings-mobile-toolbar" ref={containerRef}>
      <button
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
                  className={item.id === activeSection ? 'active' : ''}
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
}
