import {
  KeyRound,
  LoaderCircle,
  PlugZap,
  Save,
  ShieldAlert,
} from 'lucide-react';
import useAiService from '../../hooks/useAiService';
import { secretDraftLabel } from '../../app/aiServiceConfig';
import AiSettingsLoadNotice from './AiSettingsLoadNotice';
import type { MessageToast } from '../MessageToastStack';
import {
  AnimatedDisclosure,
  SettingsBadge,
  SettingsButton,
  SettingsField,
  SettingsNotice,
  SettingsSection,
  SettingsSwitch,
} from './shared';

const AVAILABLE_FEATURES = ['翻译', '摘要', '模板生成'];

type AiServiceSettingsProps = {
  onNotify?: (message: string, tone?: MessageToast['tone']) => void;
};

export default function AiServiceSettings({ onNotify = () => undefined }: AiServiceSettingsProps) {
  const {
    config,
    patchConfig,
    testing,
    saving,
    secretsLoaded,
    loadError,
    reloadConfig,
    saveError,
    testResult,
    saveConfig,
    runTestConnection,
  } = useAiService({ onNotify, serviceType: 'http' });

  const connectorEnabled = config.enabled;
  const providerEndpoint = config.endpoint;
  const providerHasApiKey = config.hasApiKey;
  const busy = saving || !secretsLoaded;

  const handleEnabledChange = (enabled: boolean) => {
    const previousValue = config.enabled;
    patchConfig({ enabled });
    // The feature gate is shared with the mail reader, which may live in a
    // different native window. Persist this switch immediately so the reader
    // cannot observe the old disabled value while this page shows it enabled.
    saveConfig({ enabled }, { persistedOnly: true }).catch(() => {
      patchConfig({ enabled: previousValue });
    });
  };

  return (
    <div className="settings-ai-page-stack">
      <AiSettingsLoadNotice loaded={secretsLoaded} error={loadError} onRetry={reloadConfig} />
      <SettingsSection
        title="AI 功能"
        description={`用于${AVAILABLE_FEATURES.join('、')}。${config.serviceType === 'mcp' ? '当前使用 MCP 服务。' : ''}`}
        badge={<SettingsBadge tone={connectorEnabled ? 'info' : 'neutral'}>
          {connectorEnabled ? '已启用' : '未启用'}
        </SettingsBadge>}
        dataSection="ai"
      >
        <SettingsSwitch
          label="启用 AI 功能"
          description="使用时，邮件内容可能会发送到你配置的外部 AI 服务；开关会立即保存。"
          checked={connectorEnabled}
          disabled={busy}
          onChange={handleEnabledChange}
        />
      </SettingsSection>

      <div className={`settings-ai-config-area${connectorEnabled ? '' : ' is-dimmed'}`}>
        <SettingsSection
          title="服务与模型"
          description="配置兼容 OpenAI API 的服务与模型。"
          dataSection="ai-llm-provider"
        >
          <SettingsField label="接入方式" labelMode="static">
            <span className="settings-ai-provider-value">OpenAI 兼容 API</span>
          </SettingsField>

          <SettingsField label="API 服务端点">
            <input
              className="settings-text-input"
              type="url"
              placeholder="https://api.example.com/v1"
              value={providerEndpoint}
              disabled={busy}
              onChange={(event) => patchConfig({ endpoint: event.target.value })}
            />
          </SettingsField>

          <SettingsField label="API Key / Token">
            <div className="settings-ai-key-row">
              <input
                className="settings-text-input"
                type="password"
                placeholder={providerHasApiKey ? '已保存，留空保持不变' : '输入访问密钥'}
                value={config.apiKey}
                disabled={busy}
                onChange={(event) => patchConfig({ apiKey: event.target.value })}
                autoComplete="off"
              />
              {providerHasApiKey && !config.apiKey ? (
                <button
                  type="button"
                  className="settings-text-button"
                  disabled={busy}
                  onClick={() => patchConfig({ clearApiKey: true, hasApiKey: false })}
                >
                  清除已保存密钥
                </button>
              ) : (
                <span className="settings-ai-key-hint">
                  <KeyRound size={12} aria-hidden="true" />
                  {secretDraftLabel(providerHasApiKey === true, config.apiKey, config.clearApiKey === true)}
                </span>
              )}
            </div>
          </SettingsField>

          <SettingsField label="模型" hint="填写服务支持的模型名称">
            <input
              className="settings-text-input"
              type="text"
              placeholder="gpt-4o-mini"
              value={config.defaultModel}
              disabled={busy}
              onChange={(event) => patchConfig({ defaultModel: event.target.value })}
            />
          </SettingsField>

          <SettingsNotice tone="warning" title="外部服务隐私" icon={ShieldAlert}>
            <p>翻译、摘要或模板生成时，相关邮件内容与提示词会发送到你配置的服务。</p>
          </SettingsNotice>
          <SettingsSwitch
            label="允许向此服务发送邮件内容"
            description="确认后才能使用外部服务。"
            checked={config.privacyAcknowledged}
            disabled={busy}
            onChange={(checked) => patchConfig({ privacyAcknowledged: checked })}
          />

          <AnimatedDisclosure
            className="settings-disclosure settings-ai-advanced"
            dataSection="ai-advanced"
            summary={(
              <>
                <span>
                  <strong>高级连接</strong>
                  <small>请求超时与其他参数</small>
                </span>
                <em>{config.timeoutSeconds ? `${config.timeoutSeconds}s` : '默认'}</em>
              </>
            )}
          >
            <div className="settings-disclosure-body st-field-grid">
              <SettingsField label="请求超时" hint="5–300 秒">
                <input
                  className="settings-text-input"
                  type="number"
                  min={5}
                  max={300}
                  step={1}
                  disabled={busy}
                  value={config.timeoutSeconds}
                  onChange={(event) => patchConfig({ timeoutSeconds: Number(event.target.value) || 30 })}
                />
              </SettingsField>
            </div>
          </AnimatedDisclosure>

          <div className="st-actions settings-ai-actions">
            <SettingsButton
              onClick={runTestConnection}
              disabled={testing || busy || !providerEndpoint.trim()}
            >
              {testing ? <LoaderCircle className="settings-action-spinner" size={14} /> : <PlugZap size={14} />}
              {testing ? '测试中…' : '测试连接'}
            </SettingsButton>
            <SettingsButton
              variant="primary"
              onClick={() => { saveConfig().catch(() => undefined); }}
              disabled={busy}
            >
              <Save size={14} />
              {saving ? '保存中…' : '保存设置'}
            </SettingsButton>
          </div>
          {saveError && <SettingsNotice tone="danger" title="保存失败"><p>{saveError}</p></SettingsNotice>}
          {testResult && <SettingsNotice tone={testResult.ok ? 'success' : 'danger'} title={testResult.ok ? '连接正常' : '连接失败'}><p>{testResult.message}</p></SettingsNotice>}

        </SettingsSection>
      </div>
    </div>
  );
}
