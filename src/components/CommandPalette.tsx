import { Search, X } from 'lucide-react';
import type { CommandPaletteItem } from '../app/types';

type CommandPaletteProps = {
  open: boolean;
  query: string;
  items: CommandPaletteItem[];
  onQueryChange: (query: string) => void;
  onRun: (item: CommandPaletteItem) => void;
  onClose: () => void;
};

export default function CommandPalette({
  open,
  query,
  items,
  onQueryChange,
  onRun,
  onClose,
}: CommandPaletteProps) {
  if (!open) return null;

  return (
    <div
      className="composer-backdrop command-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="命令面板">
        <header>
          <Search size={18} />
          <input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const first = items.find((item) => !item.disabled);
              if (first) onRun(first);
            }}
            placeholder="搜索命令、邮箱、标签或动作"
          />
          <button type="button" onClick={onClose} aria-label="关闭命令面板">
            <X size={16} />
          </button>
        </header>
        <div className="command-list">
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              disabled={item.disabled}
              onClick={() => onRun(item)}
            >
              <span>{item.section}</span>
              <strong>{item.title}</strong>
              <em>{item.hint}</em>
            </button>
          ))}
          {items.length === 0 && <p>没有匹配命令</p>}
        </div>
      </section>
    </div>
  );
}
