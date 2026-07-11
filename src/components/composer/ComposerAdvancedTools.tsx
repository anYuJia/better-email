import { Clock3, SlidersHorizontal, Trash2, Wand2 } from 'lucide-react';
import type {
  Account,
  ComposeTemplate,
  DraftInput,
  MailIdentity,
} from '../../app/types';

type ComposerAdvancedToolsProps = {
  draft: DraftInput;
  accounts: Account[];
  identities: MailIdentity[];
  accountId: number;
  identityId: number;
  templates: ComposeTemplate[];
  templateName: string;
  onPatchDraft: (patch: Partial<DraftInput>) => void;
  onApplyTemplate: (template: ComposeTemplate) => void;
  onDeleteTemplate: (template: ComposeTemplate) => void;
  onTemplateNameChange: (value: string) => void;
  onSaveTemplate: () => void;
};

export default function ComposerAdvancedTools({
  draft,
  accounts,
  identities,
  accountId,
  identityId,
  templates,
  templateName,
  onPatchDraft,
  onApplyTemplate,
  onDeleteTemplate,
  onTemplateNameChange,
  onSaveTemplate,
}: ComposerAdvancedToolsProps) {
  return (
    <details className="composer-advanced">
      <summary>
        <SlidersHorizontal size={15} />
        发送选项
        <span>
          {draft.send_at.trim() ? '已设置定时发送' : '账号 · 抄送 · 模板 · 定时'}
        </span>
      </summary>
      <div className="composer-advanced-panel">
        <section className="composer-tool-card composer-delivery-card">
          <div className="composer-advanced-row composer-route-row">
            <label className="composer-from">
              <span>账号</span>
              <select
                value={accountId}
                onChange={(event) => onPatchDraft({ account_id: Number(event.target.value), identity_id: 0 })}
              >
                {accounts.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.display_name} &lt;{entry.email}&gt;
                  </option>
                ))}
              </select>
            </label>
            <label className="composer-from">
              <span>身份</span>
              <select
                aria-label="发件身份"
                value={identityId}
                onChange={(event) => onPatchDraft({ identity_id: Number(event.target.value) })}
              >
                {identities.map((identity) => (
                  <option key={identity.id} value={identity.id}>
                    {identity.name} &lt;{identity.email}&gt;{identity.is_default ? ' · 默认' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="composer-advanced-row composer-options-row">
            <label className="composer-inline-input">
              <span>抄送</span>
              <input
                list="contact-suggestions"
                value={draft.cc}
                onChange={(event) => onPatchDraft({ cc: event.target.value })}
                placeholder="可选"
              />
            </label>
            <label className="composer-inline-input">
              <span>密送</span>
              <input
                list="contact-suggestions"
                value={draft.bcc}
                onChange={(event) => onPatchDraft({ bcc: event.target.value })}
                placeholder="可选"
              />
            </label>
            <label className="composer-schedule">
              <span>
                <Clock3 size={13} />
                定时
              </span>
              <input
                type="datetime-local"
                value={draft.send_at}
                onChange={(event) => onPatchDraft({ send_at: event.target.value })}
              />
            </label>
          </div>
        </section>

        <section className="composer-tool-card composer-template-card">
          <div className="composer-template-list">
            {templates.length === 0 && <small>暂无模板</small>}
            {templates.slice(0, 6).map((template) => (
              <span className="composer-template-row" key={template.id}>
                <button type="button" onClick={() => onApplyTemplate(template)}>
                  <Wand2 size={13} />
                  {template.name}
                </button>
                <button
                  type="button"
                  aria-label={`删除模板 ${template.name}`}
                  onClick={() => onDeleteTemplate(template)}
                >
                  <Trash2 size={12} />
                </button>
              </span>
            ))}
          </div>
          <div className="composer-template-save">
            <input
              value={templateName}
              onChange={(event) => onTemplateNameChange(event.target.value)}
              placeholder="模板名称"
            />
            <button type="button" onClick={onSaveTemplate}>保存模板</button>
          </div>
        </section>
      </div>
    </details>
  );
}
