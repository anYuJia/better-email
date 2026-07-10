import { ScanSearch, ShieldCheck } from 'lucide-react';
import type { ParsedMessagePreview } from '../../app/types';
import './automation-settings.css';

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
    <details className="settings-disclosure" data-settings-section="security-preview">
      <summary>
        <span>
          <strong>原始邮件安全预览</strong>
          <em>调试 HTML 清洗、附件和安全警告</em>
        </span>
        <b>{parsedPreview ? `${parsedPreview.attachment_count} 附件` : '调试'}</b>
      </summary>
      <section className="tool-panel raw-preview settings-security-preview">
        <header className="tool-header">
          <span>
            <strong>原始邮件安全预览</strong>
            <small>解析 MIME、清洗 HTML 并检查附件与远程资源风险</small>
          </span>
          <button type="button" onClick={onParseRawMessage}>
            <ScanSearch size={14} />
            解析
          </button>
        </header>
        <textarea value={rawMessage} onChange={(event) => onRawMessageChange(event.target.value)} />
        {parsedPreview && (
          <div className="preview-result">
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
                  className="sanitized-html-preview"
                  dangerouslySetInnerHTML={{ __html: parsedPreview.sanitized_html }}
                />
                <details>
                  <summary>清洗后的 HTML 源码</summary>
                  <pre>{parsedPreview.sanitized_html}</pre>
                </details>
              </>
            )}
            {parsedPreview.attachment_count > 0 && (
              <div className="preview-metadata">
                <span>附件 {parsedPreview.attachment_count}</span>
                {parsedPreview.attachment_names.map((name) => <em key={name}>{name}</em>)}
              </div>
            )}
            <div className="settings-warning-list">
              {parsedPreview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          </div>
        )}
      </section>
    </details>
  );
}
