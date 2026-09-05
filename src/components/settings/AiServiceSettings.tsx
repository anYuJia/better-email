import {
  CheckCircle2,
  KeyRound,
  PlugZap,
  Save,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import useAiService from '../../hooks/useAiService';
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

export default function AiServiceSettings() {
  const {
    config,
    patchConfig,
    testing,
    saving,
    saveError,
    testResult,
    saveConfig,
    runTestConnection,
  } = useAiService({ setStatus: () => undefined, serviceType: 'http' });

  const connectorEnabled = config.enabled;
  const providerEndpoint = config.endpoint;
  const providerHasApiKey = config.hasApiKey;

  return (
    <div className="settings-ai-page-stack">
      <SettingsSection
        title="AI 功能"
        description={`用于${AVAILABLE_FEATURES.join('、')}。`}
        badge={<SettingsBadge tone={connectorEnabled ? 'info' : 'neutral'}>
          {connectorEnabled ? '已启用' : '未启用'}
        </SettingsBadge>}
        dataSection="ai"
      >
        <SettingsSwitch
          label="启用 AI 功能"
          description="使用时，邮件内容可能会发送到你配置的外部 AI 服务。"
          checked={connectorEnabled}
          onChange={(checked) => patchConfig({ enabled: checked })}
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
                onChange={(event) => patchConfig({ apiKey: event.target.value })}
                autoComplete="off"
              />
              {providerHasApiKey && !config.apiKey ? (
                <button
                  type="button"
                  className="settings-text-button"
                  onClick={() => patchConfig({ clearApiKey: true, hasApiKey: false })}
                >
                  清除已保存密钥
                </button>
              ) : (
                <span className="settings-ai-key-hint">
                  <KeyRound size={12} aria-hidden="true" />
                  {providerHasApiKey ? '已保存' : '未保存'}
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
                  value={config.timeoutSeconds}
                  onChange={(event) => patchConfig({ timeoutSeconds: Number(event.target.value) || 30 })}
                />
              </SettingsField>
            </div>
          </AnimatedDisclosure>

          <div className="st-actions settings-ai-actions">
            <SettingsButton
              onClick={runTestConnection}
              disabled={testing || !connectorEnabled}
            >
              <PlugZap size={14} />
              {testing ? '测试中…' : '测试连接'}
            </SettingsButton>
            <SettingsButton
              variant="primary"
              onClick={() => { saveConfig().catch(() => undefined); }}
              disabled={saving}
            >
              <Save size={14} />
              {saving ? '保存中…' : '保存设置'}
            </SettingsButton>
          </div>

          {saveError && (
            <p className="settings-ai-save-error" role="alert">{saveError}</p>
          )}

          {testResult && (
            <div className={`settings-ai-test-result${testResult.ok ? ' ok' : ' fail'}`}>
              {testResult.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
              <span>{testResult.message}</span>
              {typeof testResult.latencyMs === 'number' && testResult.latencyMs > 0 && (
                <em>{testResult.latencyMs} ms</em>
              )}
            </div>
          )}
        </SettingsSection>
      </div>
    </div>
  );
}
