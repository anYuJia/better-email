import { ChevronDown, Clock3, SlidersHorizontal, Trash2, Wand2 } from 'lucide-react';
import type {
  Account,
  ComposeTemplate,
  DraftInput,
  MailIdentity,
} from '../../app/types';
import { CustomSelect } from '../settings/accounts/CustomSelect';

type ComposerAdvancedToolsProps = {
  draft: DraftInput;
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
        dense
        portalOwnerId="composer-sender"
        portalZIndex={1200}
        onChange={(nextValue) => onChange(Number(nextValue))}
      />
    </div>
  );
}

type ComposerSenderContextProps = {
  accounts: Account[];
  identities: MailIdentity[];
  accountId: number;
  identityId: number;
  onPatchDraft: (patch: Partial<DraftInput>) => void;
};

/**
 * The sender is part of the message itself, not an advanced preference.
 * Keep both account and identity visible throughout composition so a user
 * working across several mailboxes can verify the sending context at a glance.
 */
export function ComposerSenderContext({
  accounts,
  identities,
  accountId,
  identityId,
  onPatchDraft,
}: ComposerSenderContextProps) {
  const accountOptions = accounts.map((entry) => ({
    value: entry.id,
    label: entry.display_name || entry.email,
    meta: entry.email,
  }));
  const selectedAccount = accounts.find((entry) => entry.id === accountId) ?? null;
  const identityOptions = identities.length > 0
    ? identities.map((identity) => ({
        value: identity.id,
        label: identity.name || identity.email,
        meta: `${identity.email}${identity.is_default ? ' · 默认身份' : ''}`,
      }))
    : selectedAccount
      ? [{
          value: 0,
          label: selectedAccount.display_name || selectedAccount.email,
          meta: `${selectedAccount.email} · 账号默认身份`,
        }]
      : [];

  return (
    <section className="composer-sender-context" aria-label="发件人信息">
      <span className="composer-sender-heading">发件人</span>
      <div className="composer-sender-selectors">
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
    </section>
  );
}

export default function ComposerAdvancedTools({
  draft,
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
        <strong>更多选项</strong>
        <span>
          {draft.send_at.trim()
            ? '已设置定时发送'
            : draft.bcc.trim()
              ? '已添加密送收件人'
              : '密送 · 定时 · 模板'}
        </span>
        <ChevronDown className="composer-advanced-chevron" size={14} aria-hidden="true" />
      </summary>
      <div className="composer-advanced-panel">
        <section className="composer-delivery-controls" aria-label="其他发送选项">
          <label className="composer-inline-input">
            <span>密送</span>
            <input
              autoComplete="off"
              value={draft.bcc}
              onChange={(event) => onPatchDraft({ bcc: event.target.value })}
              placeholder="输入姓名或邮箱地址"
            />
          </label>
          <label className="composer-schedule">
            <span>
              <Clock3 size={13} />
              定时
            </span>
            <input
              type="datetime-local"
              aria-label="定时发送时间"
              value={draft.send_at}
              onChange={(event) => onPatchDraft({ send_at: event.target.value })}
            />
          </label>
        </section>

        <section className="composer-template-controls" aria-label="邮件模板">
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
