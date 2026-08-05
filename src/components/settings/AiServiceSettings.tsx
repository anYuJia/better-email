import {
  CheckCircle2,
  FlaskConical,
  Globe,
  KeyRound,
  PlugZap,
  ShieldAlert,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { AiServiceType } from '../../app/types/ai';
import useAiService from '../../hooks/useAiService';
import './ai-settings.css';

const SERVICE_OPTIONS: Array<{ value: AiServiceType; label: string; description: string }> = [
  { value: 'mock', label: '本地 mock', description: '离线模拟，无需网络，用于演示与测试。' },
  { value: 'http', label: 'HTTP API', description: 'OpenAI 兼容的 chat/completions 接口。' },
  { value: 'mcp', label: 'MCP', description: '调用外部 MCP 服务（JSON-RPC over HTTP）。' },
];

export default function AiServiceSettings() {
  const {
    config,
    patchConfig,
    maskedApiKey,
    testing,
    saving,
    testResult,
    saveConfig,
    runTestConnection,
  } = useAiService({ setStatus: () => undefined });
  const external = config.serviceType !== 'mock';
  return (
    <section className="tool-panel settings-ai-panel" data-settings-section="ai">
      <label className="checkbox-row settings-ai-enabled">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(event) => patchConfig({ enabled: event.target.checked })}
        />
        开启 AI 服务
      </label>

      <div className="settings-field">
        <span className="settings-field-label">服务类型</span>
        <div className="settings-ai-service-options">
          {SERVICE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`settings-ai-service-option${config.serviceType === option.value ? ' active' : ''}`}
            >
              <input
                type="radio"
                name="ai-service-type"
                value={option.value}
                checked={config.serviceType === option.value}
                onChange={() => patchConfig({ serviceType: option.value })}
              />
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </label>
          ))}
        </div>
      </div>

      {config.serviceType !== 'mock' && (
        <>
          <div className="settings-field">
            <span className="settings-field-label">
              {config.serviceType === 'mcp' ? 'MCP 服务地址' : 'API 服务地址'}
            </span>
            <input
              className="settings-text-input"
              type="url"
              placeholder={config.serviceType === 'mcp' ? 'https://mcp.example.com/mcp' : 'https://api.example.com/v1'}
              value={config.endpoint}
              onChange={(event) => patchConfig({ endpoint: event.target.value })}
            />
          </div>

          <div className="settings-field">
            <span className="settings-field-label">API Key / Token</span>
            <div className="settings-ai-key-row">
              <input
                className="settings-text-input"
                type="password"
                placeholder={maskedApiKey || '输入 API Key'}
                value={config.apiKey}
                onChange={(event) => patchConfig({ apiKey: event.target.value })}
                autoComplete="off"
              />
              <span className="settings-ai-key-hint"><KeyRound size={13} /> {maskedApiKey ? '已保存（输入新值可替换）' : '未保存'}</span>
            </div>
          </div>

          <div className="settings-field">
            <span className="settings-field-label">默认模型</span>
            <input
              className="settings-text-input"
              type="text"
              placeholder="gpt-4o-mini"
              value={config.defaultModel}
              onChange={(event) => patchConfig({ defaultModel: event.target.value })}
            />
          </div>

          <div className="settings-field">
            <span className="settings-field-label">超时（秒）</span>
            <input
              className="settings-text-input"
              type="number"
              min={5}
              max={300}
              value={config.timeoutSeconds}
              onChange={(event) => patchConfig({ timeoutSeconds: Number(event.target.value) || 30 })}
            />
          </div>

          <div className="settings-ai-privacy">
            <div className="settings-ai-privacy-title"><ShieldAlert size={15} /> 隐私说明</div>
            <p>
              开启翻译、模板生成或摘要后，邮件正文与提示词将被发送到上面配置的外部 AI 服务。
              请在确认服务商数据处理政策后使用；Better Email 不会在你的设备之外保存这些内容。
            </p>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={config.privacyAcknowledged}
                onChange={(event) => patchConfig({ privacyAcknowledged: event.target.checked })}
              />
              我已阅读并同意将邮件内容发送到外部 AI 服务
            </label>
          </div>
        </>
      )}

      {config.serviceType === 'mock' && (
        <div className="settings-ai-privacy">
          <div className="settings-ai-privacy-title"><FlaskConical size={15} /> 本地 mock 模式</div>
          <p>
            当前为本地模拟服务：翻译、模板生成与摘要返回稳定的示例结果，
            不会向任何外部服务器发送内容，无需网络连接。
          </p>
        </div>
      )}

      <div className="settings-ai-actions">
        <button type="button" className="secondary-action" onClick={runTestConnection} disabled={testing || !config.enabled}>
          <PlugZap size={14} />
          {testing ? '测试中…' : '测试连接'}
        </button>
        <button type="button" className="primary-action" onClick={saveConfig} disabled={saving}>
          <Globe size={14} />
          {saving ? '保存中…' : '保存设置'}
        </button>
      </div>

      {testResult && (
        <div className={`settings-ai-test-result${testResult.ok ? ' ok' : ' fail'}`}>
          {testResult.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
          <span>{testResult.message}</span>
          {typeof testResult.latencyMs === 'number' && testResult.latencyMs > 0 && (
            <em>{testResult.latencyMs} ms</em>
          )}
        </div>
      )}
    </section>
  );
}
