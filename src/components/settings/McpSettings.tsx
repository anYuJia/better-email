import {
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Link2,
  LoaderCircle,
  PlugZap,
  Save,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { AiServiceConfig } from '../../app/types/ai';
import { copyTextToClipboard } from '../../app/clipboard';
import useAiService from '../../hooks/useAiService';
import useModalAccessibility from '../../hooks/useModalAccessibility';
import {
  SettingsBadge,
  SettingsButton,
  SettingsField,
  SettingsNotice,
  SettingsSection,
  SettingsSwitch,
} from './shared';

export const MCP_INITIALIZATION_PROMPT = `请连接我提供的 MCP 服务，并按 MCP 协议完成初始化：
1. 建立连接并发送 initialize；
2. 收到服务端能力后发送 notifications/initialized；
3. 调用 tools/list，先告诉我当前可用工具及用途；
4. 执行发送邮件、修改数据、删除内容或其他不可逆操作前，先说明将使用的工具、参数和影响范围，等待我的明确确认。`;

const MCP_REFERENCE_PROMPTS = [
  '请先列出当前可用的 MCP 工具，并用一句话说明每个工具的用途。',
  '请使用合适的 MCP 工具处理下面的内容，先给出结果草稿，不要直接发送或修改任何数据。',
  '请先说明你准备调用的 MCP 工具、参数和影响范围，得到我的确认后再执行。',
];

type McpGuideTab = 'connection' | 'prompts';

type McpConnectionGuideProps = {
  config: AiServiceConfig;
  providerHasApiKey: boolean;
  openedFromEnable: boolean;
  testing: boolean;
  saving: boolean;
  saveError: string | null;
  testResult: {
    ok: boolean;
    message: string;
    latencyMs?: number;
  } | null;
  patchConfig: (patch: Partial<AiServiceConfig>) => void;
  onTestConnection: () => void;
  onSave: () => void;
  onClose: () => void;
};

function McpConnectionGuide({
  config,
  providerHasApiKey,
  openedFromEnable,
  testing,
  saving,
  saveError,
  testResult,
  patchConfig,
  onTestConnection,
  onSave,
  onClose,
}: McpConnectionGuideProps) {
  const [activeTab, setActiveTab] = useState<McpGuideTab>('connection');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const copyTimerRef = useRef<number | null>(null);

  const endpoint = config.mcpEndpoint?.trim() ?? '';
  const token = config.mcpApiKey?.trim() ?? '';
  const connectionInfo = useMemo(() => [
    'MCP 连接信息',
    `服务端点：${endpoint || '待填写'}`,
    `访问 Token：${token || (providerHasApiKey ? '（已保存，未回显）' : '（待填写）')}`,
    '连接方式：MCP Streamable HTTP / SSE',
  ].join('\n'), [endpoint, providerHasApiKey, token]);
  const initializationPrompt = useMemo(() => (
    endpoint
      ? `${MCP_INITIALIZATION_PROMPT}\n\n当前服务端点：${endpoint}`
      : MCP_INITIALIZATION_PROMPT
  ), [endpoint]);

  useModalAccessibility({
    dialogRef,
    backdropRef,
    initialFocusRef: closeButtonRef,
    onEscape: onClose,
  });

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  const handleCopy = async (key: string, value: string) => {
    try {
      await copyTextToClipboard(value);
      setCopiedKey(key);
      setCopyError(false);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null;
        setCopiedKey(null);
      }, 1800);
    } catch {
      setCopiedKey(null);
      setCopyError(true);
    }
  };

  const selectTab = (tab: McpGuideTab, focus = false) => {
    setActiveTab(tab);
    if (focus) {
      const index = tab === 'connection' ? 0 : 1;
      window.setTimeout(() => tabRefs.current[index]?.focus(), 0);
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowDown'
      && event.key !== 'ArrowLeft' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const nextIndex = index === 0 ? 1 : 0;
    selectTab(nextIndex === 0 ? 'connection' : 'prompts', true);
  };

  return (
    <div
      className="settings-mcp-guide-backdrop"
      ref={backdropRef}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={(node) => { dialogRef.current = node; }}
        className="settings-mcp-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-mcp-guide-title"
        tabIndex={-1}
      >
        <header className="settings-mcp-guide-header">
          <span className="settings-mcp-guide-mark" aria-hidden="true"><PlugZap size={18} /></span>
          <span className="settings-mcp-guide-heading">
            <strong id="settings-mcp-guide-title">连接 MCP 服务</strong>
            <small>填入服务信息，复制初始化提示词，完成一次配置。</small>
          </span>
          <button
            ref={closeButtonRef}
            type="button"
            className="settings-mcp-guide-close"
            aria-label="关闭 MCP 连接向导"
            title="关闭"
            onClick={onClose}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="settings-mcp-guide-tabs" role="tablist" aria-label="MCP 设置内容">
          <button
            ref={(node) => { tabRefs.current[0] = node; }}
            type="button"
            role="tab"
            id="settings-mcp-tab-connection"
            aria-controls="settings-mcp-panel-connection"
            aria-selected={activeTab === 'connection'}
            tabIndex={activeTab === 'connection' ? 0 : -1}
            className={activeTab === 'connection' ? 'is-active' : ''}
            onClick={() => selectTab('connection')}
            onKeyDown={(event) => handleTabKeyDown(event, 0)}
          >
            连接信息
          </button>
          <button
            ref={(node) => { tabRefs.current[1] = node; }}
            type="button"
            role="tab"
            id="settings-mcp-tab-prompts"
            aria-controls="settings-mcp-panel-prompts"
            aria-selected={activeTab === 'prompts'}
            tabIndex={activeTab === 'prompts' ? 0 : -1}
            className={activeTab === 'prompts' ? 'is-active' : ''}
            onClick={() => selectTab('prompts')}
            onKeyDown={(event) => handleTabKeyDown(event, 1)}
          >
            初始化与提示词
          </button>
        </div>

        <div className="settings-mcp-guide-content">
          {activeTab === 'connection' ? (
            <div
              className="settings-mcp-guide-panel"
              id="settings-mcp-panel-connection"
              role="tabpanel"
              aria-labelledby="settings-mcp-tab-connection"
            >
              <div className="settings-mcp-guide-intro">
                <strong>把服务商提供的连接信息填在这里</strong>
                <p>Better Email 会使用这个地址连接外部 MCP 服务，并自动完成 initialize 与 initialized 握手。</p>
              </div>

              <div className="settings-mcp-guide-direction" role="note">
                <Link2 size={15} aria-hidden="true" />
                <span><strong>连接方向</strong> Better Email → 外部 MCP 服务</span>
              </div>

              <SettingsField
                label="MCP 服务端点"
                htmlFor="settings-mcp-endpoint"
                hint="支持服务商提供的 Streamable HTTP 或 SSE 地址。"
              >
                <input
                  id="settings-mcp-endpoint"
                  className="settings-text-input"
                  type="url"
                  value={config.mcpEndpoint ?? ''}
                  placeholder="https://example.com/mcp"
                  autoComplete="url"
                  onChange={(event) => patchConfig({ mcpEndpoint: event.target.value })}
                />
              </SettingsField>

              <SettingsField
                label="访问 Token"
                htmlFor="settings-mcp-token"
                hint="Token 只保存在 Better Email 的本地设置中，不会写入复制的提示词。"
              >
                <div className="settings-mcp-token-row">
                  <input
                    id="settings-mcp-token"
                    className="settings-text-input"
                    type="password"
                    value={config.mcpApiKey ?? ''}
                    placeholder={providerHasApiKey ? '已保存，留空保持不变' : '粘贴服务商提供的 Token'}
                    autoComplete="off"
                    onChange={(event) => patchConfig({ mcpApiKey: event.target.value })}
                  />
                  {providerHasApiKey && !token ? (
                    <SettingsButton
                      size="sm"
                      variant="ghost"
                      onClick={() => patchConfig({ clearMcpApiKey: true, hasMcpApiKey: false })}
                    >
                      清除 Token
                    </SettingsButton>
                  ) : (
                    <span className="settings-mcp-token-state">
                      <KeyRound size={12} aria-hidden="true" />
                      {providerHasApiKey ? '已保存' : '未保存'}
                    </span>
                  )}
                </div>
              </SettingsField>

              <SettingsNotice tone="warning" title="邮件内容隐私" icon={ShieldAlert}>
                <p>只有打开“允许向此服务发送邮件内容”后，翻译、摘要或模板生成才会把相关内容发送到 MCP 服务。</p>
              </SettingsNotice>
              <SettingsSwitch
                className="settings-mcp-privacy-switch"
                label="允许向此服务发送邮件内容"
                description="连接测试只验证服务，不代表邮件内容已经发送。"
                checked={config.privacyAcknowledged}
                onChange={(checked) => patchConfig({ privacyAcknowledged: checked })}
              />

              <div className="settings-mcp-connection-preview">
                <div className="settings-mcp-preview-header">
                  <span>
                    <strong>连接摘要</strong>
                    <small>可复制给需要配置该服务的客户端</small>
                  </span>
                  <SettingsButton
                    size="sm"
                    variant="ghost"
                    icon={copiedKey === 'connection' ? <Check size={14} /> : <Copy size={14} />}
                    onClick={() => { void handleCopy('connection', connectionInfo); }}
                  >
                    {copiedKey === 'connection' ? '已复制' : '复制信息'}
                  </SettingsButton>
                </div>
                <pre>{connectionInfo}</pre>
                <small>出于安全原因，已保存的 Token 不会回显；需要复制完整信息时请重新输入 Token。</small>
              </div>

              <div className="st-actions settings-mcp-guide-actions">
                <SettingsButton
                  onClick={onTestConnection}
                  disabled={testing || !endpoint || !config.enabled}
                  icon={testing ? <LoaderCircle className="settings-action-spinner" size={14} /> : <PlugZap size={14} />}
                >
                  {testing ? '测试中…' : '测试连接'}
                </SettingsButton>
                {!config.enabled && (
                  <span className="settings-mcp-action-hint">请先在“AI 接入”中启用 AI 功能。</span>
                )}
              </div>

              {testResult && (
                <div className={`settings-ai-test-result${testResult.ok ? ' ok' : ' fail'}`} role={testResult.ok ? 'status' : 'alert'}>
                  {testResult.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                  <span>{testResult.message}</span>
                  {typeof testResult.latencyMs === 'number' && testResult.latencyMs > 0 && (
                    <em>{testResult.latencyMs} ms</em>
                  )}
                </div>
              )}

              {saveError && <p className="settings-ai-save-error" role="alert">{saveError}</p>}
            </div>
          ) : (
            <div
              className="settings-mcp-guide-panel settings-mcp-prompt-panel"
              id="settings-mcp-panel-prompts"
              role="tabpanel"
              aria-labelledby="settings-mcp-tab-prompts"
            >
              <div className="settings-mcp-guide-intro">
                <strong>把下面的提示词交给 AI 客户端</strong>
                <p>它们用于引导 AI 按协议初始化、先确认工具，再执行有影响的操作。</p>
              </div>

              <div className="settings-mcp-prompt-block">
                <div className="settings-mcp-preview-header">
                  <span>
                    <strong>初始化连接提示词</strong>
                    <small>协议握手由 Better Email 自动完成；这是给 AI 的行为约束。</small>
                  </span>
                  <SettingsButton
                    size="sm"
                    variant="ghost"
                    icon={copiedKey === 'initialization' ? <Check size={14} /> : <Copy size={14} />}
                    onClick={() => { void handleCopy('initialization', initializationPrompt); }}
                  >
                    {copiedKey === 'initialization' ? '已复制' : '复制提示词'}
                  </SettingsButton>
                </div>
                <textarea aria-label="初始化连接提示词" value={initializationPrompt} readOnly rows={8} />
              </div>

              <div className="settings-mcp-reference-prompts">
                <div className="settings-mcp-prompt-heading">
                  <strong>参考提示词</strong>
                  <small>按需复制到对话中使用。</small>
                </div>
                {MCP_REFERENCE_PROMPTS.map((prompt, index) => {
                  const key = `reference-${index}`;
                  return (
                    <div className="settings-mcp-reference-prompt" key={prompt}>
                      <p>{prompt}</p>
                      <SettingsButton
                        size="sm"
                        variant="ghost"
                        aria-label={`复制参考提示词 ${index + 1}`}
                        icon={copiedKey === key ? <Check size={14} /> : <Copy size={14} />}
                        onClick={() => { void handleCopy(key, prompt); }}
                      >
                        {copiedKey === key ? '已复制' : '复制'}
                      </SettingsButton>
                    </div>
                  );
                })}
              </div>

              {copyError && (
                <p className="settings-mcp-copy-error" role="alert">复制失败，请手动选择文本复制。</p>
              )}
            </div>
          )}
        </div>

        <footer className="settings-mcp-guide-footer">
          <span>{openedFromEnable ? '保存后 MCP 才会正式启用。' : '修改只在保存后生效。'}</span>
          <div>
            <SettingsButton onClick={onClose}>取消</SettingsButton>
            <SettingsButton
              variant="primary"
              aria-label={openedFromEnable ? '保存并启用' : '保存设置'}
              onClick={onSave}
              disabled={saving || !endpoint}
              icon={saving ? <LoaderCircle className="settings-action-spinner" size={14} /> : <Save size={14} />}
            >
              {saving ? '保存中…' : openedFromEnable ? '保存并启用' : '保存设置'}
            </SettingsButton>
          </div>
        </footer>
      </section>
    </div>
  );
}

function getMcpStatus(
  enabled: boolean,
  endpoint: string,
  testResult: { ok: boolean } | null,
): { tone: 'neutral' | 'info' | 'success' | 'warning'; label: string } {
  if (!enabled) return { tone: 'neutral', label: '未启用' };
  if (!endpoint) return { tone: 'warning', label: '待配置' };
  if (testResult?.ok) return { tone: 'success', label: '连接正常' };
  return { tone: 'info', label: '待测试' };
}

export default function McpSettings() {
  const {
    config,
    patchConfig,
    testing,
    saving,
    saveError,
    testResult,
    saveConfig,
    runTestConnection,
  } = useAiService({ setStatus: () => undefined, serviceType: 'mcp' });
  const [guideOpen, setGuideOpen] = useState(false);
  const [openedFromEnable, setOpenedFromEnable] = useState(false);
  const guideSnapshotRef = useRef<AiServiceConfig | null>(null);

  const connectorEnabled = config.mcpEnabled === true;
  const endpoint = config.mcpEndpoint?.trim() ?? '';
  const status = getMcpStatus(connectorEnabled, endpoint, testResult);

  const openGuide = (fromEnable: boolean) => {
    guideSnapshotRef.current = { ...config };
    setOpenedFromEnable(fromEnable);
    setGuideOpen(true);
  };

  const handleMcpEnabledChange = (checked: boolean) => {
    if (!checked) {
      guideSnapshotRef.current = null;
      setOpenedFromEnable(false);
      setGuideOpen(false);
      patchConfig({ mcpEnabled: false });
      return;
    }

    patchConfig({ mcpEnabled: true });
    openGuide(!connectorEnabled);
  };

  const closeGuide = () => {
    if (guideSnapshotRef.current) patchConfig(guideSnapshotRef.current);
    guideSnapshotRef.current = null;
    setOpenedFromEnable(false);
    setGuideOpen(false);
  };

  const saveAndCloseGuide = () => {
    saveConfig()
      .then(() => {
        guideSnapshotRef.current = null;
        setOpenedFromEnable(false);
        setGuideOpen(false);
      })
      .catch(() => undefined);
  };

  return (
    <div className="settings-mcp-page-stack">
      <SettingsSection
        title="连接状态"
        description="连接外部 MCP 服务，为 AI 功能提供工具能力。"
        badge={<SettingsBadge tone={status.tone}>{status.label}</SettingsBadge>}
        dataSection="mcp"
      >
        <SettingsSwitch
          label="启用 MCP"
          description="开启后立即打开连接向导，填入服务商提供的地址和 Token。"
          ariaLabel="启用 MCP"
          checked={connectorEnabled}
          onChange={handleMcpEnabledChange}
        />
        {connectorEnabled && !config.enabled && (
          <p className="settings-ai-gated-note">
            使用 MCP 处理邮件前，还需要在“AI 接入”中启用 AI 功能。
          </p>
        )}
      </SettingsSection>

      <SettingsSection
        title="连接信息"
        description="管理 MCP 服务端点、访问 Token 与连接状态。"
        dataSection="mcp-connection"
      >
        {connectorEnabled ? (
          <div className="settings-mcp-summary">
            <span className="settings-mcp-summary-mark" aria-hidden="true"><PlugZap size={16} /></span>
            <span className="settings-mcp-summary-copy">
              <strong>{endpoint || '尚未配置 MCP 服务端点'}</strong>
              <small>{endpoint ? '外部 MCP 服务端点' : '开启连接向导后填写服务商提供的地址'}</small>
            </span>
            <SettingsButton size="sm" variant="ghost" onClick={() => openGuide(false)}>
              查看连接信息
            </SettingsButton>
          </div>
        ) : (
          <div className="settings-mcp-setup-row">
            <span className="settings-mcp-summary-mark" aria-hidden="true"><PlugZap size={16} /></span>
            <span className="settings-mcp-summary-copy">
              <strong>配置 MCP 服务端点</strong>
              <small>开启 MCP 后会直接弹出连接信息、Token 输入和初始化提示词。</small>
            </span>
            <SettingsButton size="sm" variant="ghost" onClick={() => handleMcpEnabledChange(true)}>
              开始配置
            </SettingsButton>
          </div>
        )}
      </SettingsSection>

      {guideOpen && (
        <McpConnectionGuide
          config={config}
          providerHasApiKey={config.hasMcpApiKey === true}
          openedFromEnable={openedFromEnable}
          testing={testing}
          saving={saving}
          saveError={saveError}
          testResult={testResult}
          patchConfig={patchConfig}
          onTestConnection={runTestConnection}
          onSave={saveAndCloseGuide}
          onClose={closeGuide}
        />
      )}
    </div>
  );
}
