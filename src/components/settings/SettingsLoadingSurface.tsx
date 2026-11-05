import { X } from 'lucide-react';
import './settings-loading.css';

/** Lightweight first-open surface. Settings code can load without dimming the
 * mail workspace or preventing an immediate cancellation. */
export default function SettingsLoadingSurface({ onClose }: { onClose?: () => void }) {
  return <section className="settings-loading-surface" aria-label="设置" aria-busy="true">
    <header><strong>设置</strong>{onClose && <button type="button" aria-label="关闭设置" onClick={onClose}><X size={18} aria-hidden="true" /></button>}</header>
    <div role="status">正在准备设置…</div>
  </section>;
}
