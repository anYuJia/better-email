import { ScanSearch, ShieldCheck } from 'lucide-react';
import type { ParsedMessagePreview } from '../../app/types';
import { SettingsButton, SettingsSection } from './shared';

type SecurityPreviewSettingsProps = {
  rawMessage: string;
  parsedPreview: ParsedMessagePreview | null;
  onRawMessageChange: (value: string) => void;
  onParseRawMessage: () => void;
};

export default function SecurityPreviewSettings({
  rawMessage,
  parsedPreview,
  onRawMessageChange,
  onParseRawMessage,
}: SecurityPreviewSettingsProps) {
  return (
    <>
      <SettingsSection
        title="安全解析状态"
        description="调试 HTML 清洗、附件和远程资源风险"
        badge={<span className="st-badge st-badge-neutral">{parsedPreview ? `${parsedPreview.attachment_count} 附件` : '等待解析'}</span>}
        dataSection="security-preview"
      >
        <SettingsSection title="原始邮件安全预览" description="解析 MIME、清洗 HTML 并检查附件与远程资源风险" actions={
          <SettingsButton variant="primary" icon={<ScanSearch size={14} />} onClick={onParseRawMessage}>
            解析
          </SettingsButton>
        }>
          <textarea
            className="settings-security-preview-source"
            rows={5}
            value={rawMessage}
            onChange={(event) => onRawMessageChange(event.target.value)}
          />
          {parsedPreview && (
            <div className="settings-preview-result">
              <header>
                <ShieldCheck size={17} />
                <span>
                  <strong>{parsedPreview.subject}</strong>
                  <small>{parsedPreview.from} → {parsedPreview.to}</small>
                </span>
              </header>
              <pre>{parsedPreview.body_preview}</pre>
              {parsedPreview.sanitized_html && (
                <>
                  <div
                    className="settings-sanitized-html-preview"
                    dangerouslySetInnerHTML={{ __html: parsedPreview.sanitized_html }}
                  />
                  <details>
                    <summary>清洗后的 HTML 源码</summary>
                    <pre>{parsedPreview.sanitized_html}</pre>
                  </details>
                </>
              )}
              {parsedPreview.attachment_count > 0 && (
                <div className="settings-preview-metadata">
                  <span>附件 {parsedPreview.attachment_count}</span>
                  {parsedPreview.attachment_names.map((name) => <em key={name}>{name}</em>)}
                </div>
              )}
              <div className="settings-warning-list">
                {parsedPreview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            </div>
          )}
        </SettingsSection>
      </SettingsSection>
    </>
  );
}
