import type { UseAppAutoUpdateOptions } from '../hooks/useAppAutoUpdate';
import useAppAutoUpdate from '../hooks/useAppAutoUpdate';
import AppUpdatePrompt from './AppUpdatePrompt';

type AppUpdateSurfaceProps = UseAppAutoUpdateOptions;

export default function AppUpdateSurface(props: AppUpdateSurfaceProps) {
  const {
    update,
    installing,
    progress,
    error,
    install,
    dismiss,
  } = useAppAutoUpdate(props);

  if (!update || props.standaloneSettingsWindow) return null;

  return (
    <AppUpdatePrompt
      update={update}
      installing={installing}
      progress={progress}
      error={error}
      onInstall={() => { void install(); }}
      onDismiss={dismiss}
    />
  );
}
