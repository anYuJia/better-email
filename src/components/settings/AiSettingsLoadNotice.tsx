import { SettingsButton, SettingsNotice } from './shared';

export default function AiSettingsLoadNotice({ loaded, error, onRetry }: {
  loaded: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loaded) return null;
  return (
    <SettingsNotice
      tone={error ? 'danger' : 'info'}
      title={error ? '设置暂时不可用' : '正在读取设置…'}
      action={error ? <SettingsButton size="sm" onClick={onRetry}>重新读取</SettingsButton> : undefined}
    >
      <p>{error || '读取完成后即可编辑，已保存的配置会保持不变。'}</p>
    </SettingsNotice>
  );
}
