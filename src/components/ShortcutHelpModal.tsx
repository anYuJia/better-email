import { shortcutGroups } from '../app/appConfig';

type ShortcutHelpModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function ShortcutHelpModal({
  open,
  onClose,
}: ShortcutHelpModalProps) {
  if (!open) return null;

  return (
    <div
      className="composer-backdrop shortcut-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="shortcut-modal" role="dialog" aria-modal="true" aria-label="快捷键帮助">
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
