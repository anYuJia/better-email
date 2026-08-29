import { useRef } from 'react';
import { shortcutGroups } from '../app/appConfig';
import useModalAccessibility from '../hooks/useModalAccessibility';

type ShortcutHelpModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function ShortcutHelpModal({
  open,
  onClose,
}: ShortcutHelpModalProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleId = 'shortcut-help-title';
  const descriptionId = 'shortcut-help-description';

  useModalAccessibility({
    open,
    dialogRef,
    backdropRef,
    initialFocusRef: closeButtonRef,
    onEscape: onClose,
  });

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      className="composer-backdrop shortcut-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="shortcut-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header className="shortcut-modal-header">
          <div className="shortcut-title-copy">
            <h2 id={titleId}>快捷键</h2>
            <p id={descriptionId}>高频邮件操作，无需离开键盘</p>
          </div>
          <button
            ref={closeButtonRef}
            className="shortcut-close-button"
            type="button"
            onClick={onClose}
          >
            关闭
          </button>
        </header>
        <div className="shortcut-grid">
          {shortcutGroups.map((group) => (
            <section className="shortcut-group" key={group.title} aria-labelledby={`shortcut-group-${group.title}`}>
              <h3 id={`shortcut-group-${group.title}`}>{group.title}</h3>
              <div className="shortcut-list">
                {group.items.map((item) => (
                  <div className="shortcut-row" key={`${group.title}-${item.label}`}>
                    <span>{item.label}</span>
                    <div aria-label={item.keys.join(' 加 ')}>
                      {item.keys.map((key) => <kbd key={key}>{key}</kbd>)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
