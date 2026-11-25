import { useEffect, useState } from 'react';

const preferenceKey = 'better-email.compact-message-list';
const changeEvent = 'better-email:message-list-density';

function readPreference() {
  return window.localStorage.getItem(preferenceKey) === 'true';
}

export function setCompactMessageList(compact: boolean) {
  window.localStorage.setItem(preferenceKey, String(compact));
  window.dispatchEvent(new Event(changeEvent));
}

export default function useCompactMessageList() {
  const [compact, setCompact] = useState(readPreference);
  useEffect(() => {
    const sync = () => setCompact(readPreference());
    const onStorage = (event: StorageEvent) => {
      if (event.key === preferenceKey || event.key === null) sync();
    };
    window.addEventListener(changeEvent, sync);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', sync);
    sync();
    return () => {
      window.removeEventListener(changeEvent, sync);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', sync);
    };
  }, []);
  return compact;
}
