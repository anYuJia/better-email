import { Clock3, SlidersHorizontal, Trash2, Wand2 } from 'lucide-react';
import type {
  Account,
  ComposeTemplate,
  DraftInput,
  MailIdentity,
} from '../../app/types';
import { CustomSelect } from '../settings/accounts/CustomSelect';

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

type ComposerSelectOption = {
  value: number;
  label: string;
  meta?: string;
};

type ComposerInlineSelectProps = {
  label: string;
  ariaLabel?: string;
  value: number;
  options: ComposerSelectOption[];
  onChange: (value: number) => void;
};

function ComposerInlineSelect({ label, ariaLabel, value, options, onChange }: ComposerInlineSelectProps) {
  const selected = options.find((option) => option.value === value) ?? options[0] ?? null;

  return (
    <div className="composer-from composer-inline-select">
      <span>{label}</span>
      <CustomSelect
        ariaLabel={ariaLabel ?? label}
        value={selected ? String(selected.value) : ''}
        options={options.map((option) => ({
          value: String(option.value),
          label: option.label,
          meta: option.meta,
        }))}
        onChange={(nextValue) => onChange(Number(nextValue))}
      />
    </div>
  );
}

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
  const accountOptions = accounts.map((entry) => ({
    value: entry.id,
    label: entry.display_name,
    meta: entry.email,
  }));
  const identityOptions = identities.map((identity) => ({
    value: identity.id,
    label: identity.name,
    meta: `${identity.email}${identity.is_default ? ' · 默认' : ''}`,
  }));

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
            <ComposerInlineSelect
              label="账号"
              ariaLabel="发件账号"
              value={accountId}
              options={accountOptions}
              onChange={(nextAccountId) => onPatchDraft({ account_id: nextAccountId, identity_id: 0 })}
            />
            <ComposerInlineSelect
              label="身份"
              ariaLabel="发件身份"
              value={identityId}
              options={identityOptions}
              onChange={(nextIdentityId) => onPatchDraft({ identity_id: nextIdentityId })}
            />
          </div>

          <div className="composer-advanced-row composer-options-row">
            <label className="composer-inline-input">
              <span>抄送</span>
              <input
                autoComplete="off"
                value={draft.cc}
                onChange={(event) => onPatchDraft({ cc: event.target.value })}
                placeholder="可选"
              />
            </label>
            <label className="composer-inline-input">
              <span>密送</span>
              <input
                autoComplete="off"
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
            <button type="button" onClick={onSaveTemplate}>保存当前</button>
          </div>
        </section>
      </div>
    </details>
  );
}
