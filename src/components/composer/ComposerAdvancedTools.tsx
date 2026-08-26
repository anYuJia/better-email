import { ChevronDown, SlidersHorizontal, Trash2, Wand2 } from 'lucide-react';
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
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onApplyTemplate: (template: ComposeTemplate) => void;
  onDeleteTemplate: (template: ComposeTemplate) => void;
  onTemplateNameChange: (value: string) => void;
  onSaveTemplate: () => void;
  onSaveDraft?: () => void;
};

type ComposerSenderContextProps = {
  accounts: Account[];
  identities: MailIdentity[];
  accountId: number;
  identityId: number;
  onPatchDraft: (patch: Partial<DraftInput>) => void;
};

export function ComposerSenderContext({
  accounts,
  identities,
  accountId,
  identityId,
  onPatchDraft,
}: ComposerSenderContextProps) {
  const selectedAccount = accounts.find((entry) => entry.id === accountId) ?? null;
  const availableIdentities = identities.filter((identity) => identity.account_id === accountId);
  const selectedIdentity = availableIdentities.find((identity) => identity.id === identityId)
    ?? availableIdentities.find((identity) => identity.is_default)
    ?? availableIdentities[0]
    ?? null;

  const accountOptions = accounts.map((entry) => ({
    value: `account:${entry.id}`,
    label: entry.display_name || entry.email,
    meta: `<${entry.email}>`,
  }));
  const identityOptions = availableIdentities.map((identity) => ({
    value: `identity:${identity.id}`,
    label: identity.name || identity.email,
    meta: `<${identity.email}>${identity.is_default ? ' · 默认身份' : ''}`,
  }));
  const options = [...accountOptions, ...identityOptions];
  const selectedValue = selectedIdentity
    ? `identity:${selectedIdentity.id}`
    : selectedAccount
      ? `account:${selectedAccount.id}`
      : '';

  return (
    <section className="composer-sender-context" aria-label="发件人信息">
      <span className="composer-sender-heading">发件人</span>
      <div className="composer-sender-selectors">
        <CustomSelect
          ariaLabel="发件人"
          value={selectedValue}
          options={options}
          dense
          portalOwnerId="composer-sender"
          portalZIndex={1200}
          onChange={(nextValue) => {
            const [kind, rawId] = nextValue.split(':');
            const nextId = Number(rawId);
            if (!Number.isFinite(nextId)) return;
            if (kind === 'account') {
              onPatchDraft({ account_id: nextId, identity_id: 0 });
            } else if (kind === 'identity') {
              onPatchDraft({ identity_id: nextId });
            }
          }}
        />
      </div>
    </section>
  );
}

export default function ComposerAdvancedTools({
  draft,
  templates,
  templateName,
  open,
  onOpenChange,
  onApplyTemplate,
  onDeleteTemplate,
  onTemplateNameChange,
  onSaveTemplate,
  onSaveDraft,
}: ComposerAdvancedToolsProps) {
  void draft;

  return (
    <details
      className="composer-advanced"
      open={open}
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
    >
      <summary>
        <SlidersHorizontal size={15} aria-hidden="true" />
        <strong>更多</strong>
        <span>模板与低频操作</span>
        <ChevronDown className="composer-advanced-chevron" size={14} aria-hidden="true" />
      </summary>
      <div className="composer-advanced-panel">
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
          {onSaveDraft ? (
            <button type="button" className="composer-template-save-draft" onClick={onSaveDraft}>
              保存草稿
            </button>
          ) : null}
        </section>
      </div>
    </details>
  );
}
