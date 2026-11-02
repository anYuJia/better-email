import { useEffect, useState } from 'react';
import { IPC } from '../ipc/commands';
import { invoke, mockMode } from '../tauriBridge';

export type NativePlatform = 'android' | 'ios' | 'desktop' | 'web';

export default function useNativePlatform() {
  const [nativePlatform, setNativePlatform] = useState<NativePlatform>(
    () => (mockMode ? 'web' : 'desktop'),
  );
  const [nativePlatformResolved, setNativePlatformResolved] = useState(mockMode);

  useEffect(() => {
    let active = true;
    invoke<string>(IPC.GetPlatform)
      .then((platform) => {
        if (!active) return;
        if (platform === 'android' || platform === 'ios') {
          setNativePlatform(platform);
        } else if (platform === 'macos' || platform === 'windows' || platform === 'linux') {
          setNativePlatform('desktop');
        }
        setNativePlatformResolved(true);
      })
      .catch(() => {
        // Browser preview and component tests do not expose the native command.
        if (active) setNativePlatformResolved(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return { nativePlatform, nativePlatformResolved };
}
