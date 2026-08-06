import { Check } from 'lucide-react';

export type MessageToast = { id: number; text: string };

type MessageToastStackProps = {
  toasts: MessageToast[];
};

export default function MessageToastStack({ toasts }: MessageToastStackProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="message-toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="message-toast">
          <Check size={13} strokeWidth={2.5} />
          <span>{toast.text}</span>
        </div>
      ))}
    </div>
  );
}
