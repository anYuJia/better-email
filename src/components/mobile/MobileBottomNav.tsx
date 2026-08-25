import {
  Mail,
  PenLine,
  Settings,
  Star,
} from 'lucide-react';
import type { FilterMode } from '../../app/types';

type MobileBottomNavProps = {
  filter: FilterMode;
  onOpenMail: () => void;
  onOpenStarred: () => void;
  onCompose: () => void;
  onOpenSettings: () => void;
};

export default function MobileBottomNav({
  filter,
  onOpenMail,
  onOpenStarred,
  onCompose,
  onOpenSettings,
}: MobileBottomNavProps) {
  return (
    <nav className="mobile-bottom-nav" aria-label="主导航">
      <button
        type="button"
        className={filter !== 'starred' ? 'active' : ''}
        aria-current={filter !== 'starred' ? 'page' : undefined}
        onClick={onOpenMail}
      >
        <Mail size={21} aria-hidden="true" />
        <span>邮件</span>
      </button>
      <button
        type="button"
        className={filter === 'starred' ? 'active' : ''}
        aria-current={filter === 'starred' ? 'page' : undefined}
        onClick={onOpenStarred}
      >
        <Star size={21} fill={filter === 'starred' ? 'currentColor' : 'none'} aria-hidden="true" />
        <span>星标</span>
      </button>
      <button type="button" className="mobile-bottom-compose" aria-label="写邮件" onClick={onCompose}>
        <span className="mobile-bottom-compose-icon">
          <PenLine size={22} aria-hidden="true" />
        </span>
        <span>写邮件</span>
      </button>
      <button type="button" onClick={onOpenSettings}>
        <Settings size={21} aria-hidden="true" />
        <span>设置</span>
      </button>
    </nav>
  );
}
