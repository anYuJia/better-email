import { useCallback, useRef, useState } from 'react';
import type { MessageToast } from '../components/MessageToastStack';

const SUCCESS_DURATION_MS = 3000;
const ERROR_DURATION_MS = 5000;

export default function useMessageToastQueue() {
  const [toasts, setToasts] = useState<MessageToast[]>([]);
  const nextIdRef = useRef(0);
  const activeKeysRef = useRef(new Set<string>());

  const showToast = useCallback((text: string, tone: MessageToast['tone'] = 'success') => {
    const normalizedText = text.trim();
    const resolvedTone = tone ?? 'success';
    if (!normalizedText) return;

    const key = `${resolvedTone}:${normalizedText}`;
    if (activeKeysRef.current.has(key)) return;
    activeKeysRef.current.add(key);

    const id = ++nextIdRef.current;
    setToasts((current) => [...current, { id, text: normalizedText, tone: resolvedTone }]);
    window.setTimeout(() => {
      activeKeysRef.current.delete(key);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, resolvedTone === 'error' ? ERROR_DURATION_MS : SUCCESS_DURATION_MS);
  }, []);

  return { toasts, showToast };
}
