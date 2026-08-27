import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, FileText, LoaderCircle, Save, Trash2, X } from 'lucide-react';
import type {
  Account,
  ComposeTemplate,
  DraftInput,
  MailIdentity,
} from '../../app/types';
import { CustomSelect } from '../settings/accounts/CustomSelect';

export type ComposerPopoverMode = 'templates' | 'more' | null;

type ComposerAdvancedToolsProps = {
  mode: ComposerPopoverMode;
  anchorRef?: RefObject<HTMLElement | null>;
  templates: ComposeTemplate[];
  templateName: string;
  onClose: () => void;
  onApplyTemplate: (template: ComposeTemplate) => void;
  onDeleteTemplate: (template: ComposeTemplate) => void;
  onTemplateNameChange: (value: string) => void;
  onSaveTemplate: () => void;
  onSaveDraft?: () => Promise<void> | void;
  saveDraftPending?: boolean;
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
            if (kind === 'account') onPatchDraft({ account_id: nextId, identity_id: 0 });
            else if (kind === 'identity') onPatchDraft({ identity_id: nextId });
          }}
        />
      </div>
    </section>
  );
}

function clampPosition(anchor: HTMLElement | null, popover: HTMLElement | null) {
  if (!anchor || !popover) return null;
  const anchorRect = anchor.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const margin = 12;
  const gap = 8;
  const left = Math.min(
    Math.max(margin, anchorRect.left),
    Math.max(margin, window.innerWidth - popoverRect.width - margin),
  );
  const below = anchorRect.bottom + gap;
  const above = anchorRect.top - popoverRect.height - gap;
  const top = below + popoverRect.height <= window.innerHeight - margin
    ? below
    : above >= margin
      ? above
      : Math.min(Math.max(margin, below), Math.max(margin, window.innerHeight - popoverRect.height - margin));
  return { top, left };
}

export default function ComposerAdvancedTools({
  mode,
  anchorRef,
  templates,
  templateName,
  onClose,
  onApplyTemplate,
  onDeleteTemplate,
  onTemplateNameChange,
  onSaveTemplate,
  onSaveDraft,
  saveDraftPending = false,
}: ComposerAdvancedToolsProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const firstActionRef = useRef<HTMLButtonElement | null>(null);
  const saveEntryRef = useRef<HTMLButtonElement | null>(null);
  const templateNameRef = useRef<HTMLInputElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const menuItemsRef = useRef<HTMLButtonElement[]>([]);

  useLayoutEffect(() => {
    if (!mode) return undefined;
    const update = () => setPosition(clampPosition(anchorRef?.current ?? null, popoverRef.current));
    update();
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
    };
  }, [anchorRef, mode, saveDialogOpen, templates.length]);

  useEffect(() => {
    if (!mode) return undefined;
    const focusTarget = saveDialogOpen
      ? templateNameRef.current
      : firstActionRef.current ?? saveEntryRef.current;
    focusTarget?.focus({ preventScroll: true });
    function closeOnPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && (popoverRef.current?.contains(target) || anchorRef?.current?.contains(target))) return;
      if (saveDraftPending) return;
      onClose();
    }
    function closeOnKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (saveDraftPending) return;
        if (saveDialogOpen) setSaveDialogOpen(false);
        else onClose();
        return;
      }
      if (saveDialogOpen || (mode !== 'more' && mode !== 'templates')) return;
      const items = menuItemsRef.current.filter(Boolean);
      if (items.length === 0) return;
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        (event.key === 'Home' ? items[0] : items[items.length - 1])?.focus();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        items[(currentIndex + delta + items.length) % items.length]?.focus();
      }
    }
    document.addEventListener('pointerdown', closeOnPointerDown, true);
    document.addEventListener('keydown', closeOnKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown, true);
      document.removeEventListener('keydown', closeOnKeyDown, true);
    };
  }, [anchorRef, mode, onClose, saveDialogOpen, saveDraftPending]);

  useEffect(() => {
    if (mode) return;
    setSaveDialogOpen(false);
  }, [mode]);

  if (!mode) return null;

  const templateItems = templates.slice().sort((left, right) => (
    Date.parse(right.updated_at) - Date.parse(left.updated_at)
  )).slice(0, 6);

  const popover = (
    <div
      ref={popoverRef}
      className={`composer-advanced-popover composer-${mode}-popover`}
      style={{ top: position?.top ?? -10000, left: position?.left ?? -10000 }}
      role={mode === 'more' ? 'menu' : 'dialog'}
      aria-label={mode === 'more' ? '更多写信工具' : '邮件模板'}
    >
      <header>
        <strong>{mode === 'more' ? '更多' : '模板'}</strong>
        <button type="button" aria-label="关闭浮层" title="关闭" disabled={saveDraftPending} onClick={onClose}><X size={15} /></button>
      </header>

      {mode === 'templates' ? (
        <>
          {templateItems.length === 0 ? (
            <div className="composer-template-empty">
              <FileText size={17} aria-hidden="true" />
              <span>暂无模板</span>
              <small>保存一封常用邮件，之后可以快速套用。</small>
            </div>
          ) : (
            <div className="composer-template-list" role="menu" aria-label="最近使用模板">
              {templateItems.map((template, index) => (
                <div className="composer-template-row" key={template.id}>
                  <button
                    ref={(element) => {
                      if (element) menuItemsRef.current[index] = element;
                      if (index === 0) firstActionRef.current = element;
                    }}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onApplyTemplate(template);
                      onClose();
                    }}
                  >
                    <FileText size={14} aria-hidden="true" />
                    <span>{template.name}</span>
                  </button>
                  <button type="button" aria-label={`删除模板 ${template.name}`} title={`删除模板 ${template.name}`} onClick={() => onDeleteTemplate(template)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button ref={saveEntryRef} type="button" className="composer-template-save-entry" onClick={() => setSaveDialogOpen(true)}>
            <Save size={14} aria-hidden="true" />保存为模板…
          </button>
          {saveDialogOpen && (
            <div className="composer-template-save-dialog" role="dialog" aria-label="保存为模板">
              <strong>保存为模板</strong>
              <label>
                <span>模板名称</span>
                <input
                  ref={templateNameRef}
                  aria-label="模板名称"
                  value={templateName}
                  onChange={(event) => onTemplateNameChange(event.target.value)}
                  placeholder="例如：项目周报"
                />
              </label>
              <footer>
                <button type="button" onClick={() => setSaveDialogOpen(false)}>取消</button>
                <button
                  type="button"
                  className="is-primary"
                  disabled={!templateName.trim()}
                  onClick={() => {
                    onSaveTemplate();
                    setSaveDialogOpen(false);
                    onClose();
                  }}
                >
                  <Check size={13} aria-hidden="true" />保存
                </button>
              </footer>
            </div>
          )}
        </>
      ) : (
        <div className="composer-more-menu" role="menu">
          {onSaveDraft ? (
            <button
              ref={(element) => {
                if (element) menuItemsRef.current[0] = element;
                firstActionRef.current = element;
              }}
              type="button"
              role="menuitem"
              disabled={saveDraftPending}
              aria-busy={saveDraftPending || undefined}
              onClick={() => { void onSaveDraft(); }}
            >
              {saveDraftPending
                ? <LoaderCircle className="spinning" size={14} aria-hidden="true" />
                : <Save size={14} aria-hidden="true" />}
              {saveDraftPending ? '正在保存…' : '保存并关闭'}
            </button>
          ) : (
            <span className="composer-more-empty">暂无其他写信工具</span>
          )}
        </div>
      )}
    </div>
  );

  return createPortal(popover, document.body);
}
