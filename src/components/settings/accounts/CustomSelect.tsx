import React from 'react';
import { ChevronDown } from 'lucide-react';

type Option = { value: string; label: string };

export function CustomSelect({
  value,
  options,
  onChange,
  className = '',
}: {
  value: string;
  options: readonly Option[] | Option[];
  onChange: (val: string) => void;
  className?: string;
}) {
  const activeOption = options.find((o) => o.value === value) || options[0];
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDetailsElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  return (
    <details
      ref={containerRef}
      className={`custom-select-menu ${className}`}
      open={open}
      onClick={(e) => {
        e.preventDefault();
        setOpen(!open);
      }}
    >
      <summary>
        <span>{activeOption?.label}</span>
        <ChevronDown size={14} style={{ opacity: 0.7 }} />
      </summary>
      <div className="custom-select-dropdown">
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            className={option.value === value ? 'active' : ''}
            onClick={() => {
              onChange(option.value);
              setOpen(false);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </details>
  );
}
