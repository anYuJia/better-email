import { PenLine } from 'lucide-react';
import type { FilterMode } from '../../app/types';

type MobileBottomNavProps = {
  filter: FilterMode;
  onOpenMail: () => void;
  onOpenStarred: () => void;
  onCompose: () => void;
  onOpenSettings: () => void;
};

/**
 * Mobile mail no longer has a generic four-tab bottom navigation. Mail and
 * starred are states of the inbox, settings lives in mailbox navigation, and
 * compose is the only global action that benefits from persistent reachability.
 *
 * Keep the legacy callback shape for App-level compatibility while the shell
 * owns the migration; only onCompose is rendered here.
 */
export default function MobileBottomNav({ onCompose }: MobileBottomNavProps) {
  return (
    <div className="mobile-bottom-nav" role="group" aria-label="邮件快捷操作">
      <button type="button" className="mobile-bottom-compose" aria-label="写邮件" onClick={onCompose}>
        <span className="mobile-bottom-compose-icon">
          <PenLine size={22} aria-hidden="true" />
        </span>
        <span>写邮件</span>
      </button>
    </div>
  );
}
