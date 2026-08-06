import { X } from 'lucide-react';
import type { UndoAction } from '../app/types';
import type { SendUndoDelaySeconds } from '../app/appConfig';

export type PendingSendUndo = {
  outboxId: number;
  subject: string;
  expiresAt: string;
  delaySeconds: SendUndoDelaySeconds;
};

type UndoSnackbarStackProps = {
  undoAction: UndoAction | null;
  onUndoAction: () => void;
  onDismissAction: () => void;
};

export default function UndoSnackbarStack({
  undoAction,
  onUndoAction,
  onDismissAction,
}: UndoSnackbarStackProps) {
  if (!undoAction) return null;

  return (
    <div className="snackbar-stack">
      {undoAction && (
        <section className="undo-snackbar" role="status" aria-live="polite">
          <div>
            <strong>{undoAction.title}</strong>
            <span>{undoAction.detail}</span>
          </div>
          <button type="button" onClick={onUndoAction}>
            撤销
          </button>
          <button type="button" className="undo-close" aria-label="关闭撤销提示" onClick={onDismissAction}>
            <X size={15} />
          </button>
        </section>
      )}
    </div>
  );
}
