import { useEffect, useRef } from 'react';
import { shortcutGroups } from '../app/appConfig';

type ShortcutHelpModalProps = {
  open: boolean;
  onClose: () => void;
};

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => !element.hasAttribute('disabled'));
}

export default function ShortcutHelpModal({
  open,
  onClose,
}: ShortcutHelpModalProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // 打开时保存原焦点，并把焦点移到弹窗内第一个可操作元素。
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (dialog) {
      focusableElements(dialog)[0]?.focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = focusableElements(dialog);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const isInside = active instanceof HTMLElement && dialog.contains(active);
      if (event.shiftKey) {
        if (active === first || !isInside) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !isInside) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // 关闭后恢复到打开前的有效焦点元素（仍在文档中才恢复）。
      const previous = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (previous && document.contains(previous)) {
        previous.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="composer-backdrop shortcut-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="shortcut-modal"
        role="dialog"
        aria-modal="true"
        aria-label="快捷键帮助"
      >
        <header>
          <div>
            <strong>快捷键</strong>
            <span>高频邮件操作，不离开键盘。</span>
          </div>
          <button type="button" onClick={onClose}>关闭</button>
        </header>
        <div className="shortcut-grid">
          {shortcutGroups.map((group) => (
            <section className="shortcut-group" key={group.title}>
              <strong>{group.title}</strong>
              {group.items.map((item) => (
                <div className="shortcut-row" key={`${group.title}-${item.label}`}>
                  <span>{item.label}</span>
                  <div>
                    {item.keys.map((key) => <kbd key={key}>{key}</kbd>)}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
