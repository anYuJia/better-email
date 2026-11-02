import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, FileSignature, FileText, LoaderCircle, Save, Trash2, X } from 'lucide-react';
import type {
  Account,
  ComposeTemplate,
  ComposerSaveResult,
  DraftInput,
  MailIdentity,
} from '../../app/types';
import { useWheelContainment } from '../../hooks/useWheelContainment';
import usePopoverPresence from '../../hooks/usePopoverPresence';
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
  onSaveTemplate: () => ComposerSaveResult | void;
  onSaveDraft?: () => Promise<void> | void;
  saveDraftPending?: boolean;
  saveDraftBlockedReason?: string | null;
  saveDraftFeedback?: { message: string; error: boolean } | null;
  signature?: string;
  onInsertSignature?: () => void;
  onOpenTemplates?: () => void;
};

type ComposerSenderContextProps = {
  active?: boolean;
  accounts: Account[];
  identities: MailIdentity[];
  accountId: number;
  identityId: number;
  onPatchDraft: (patch: Partial<DraftInput>) => void;
};

export function ComposerSenderContext({
  active = true,
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

  // Build sender options grouped by account without duplicate default identities
  const options: Array<{ value: string; label: string; meta?: string }> = [];
  const sameText = (left: string, right: string) => left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();

  for (const acc of accounts) {
    const accIdentities = identities.filter((identity) => identity.account_id === acc.id);
    const accDefaultIdentity = accIdentities.find((identity) => identity.is_default) ?? accIdentities[0];

    if (accIdentities.length === 0) {
      const label = acc.display_name.trim() || acc.email;
      options.push({
        value: `account:${acc.id}`,
        label,
        meta: sameText(label, acc.email) ? undefined : `<${acc.email}>`,
      });
    } else {
      for (const identity of accIdentities) {
        const isDefault = identity.id === accDefaultIdentity?.id;
        const hasDistinctName = Boolean(identity.name && identity.name !== acc.display_name);
        const hasDistinctEmail = Boolean(identity.email && identity.email !== acc.email);
        const hasDistinctReplyTo = Boolean(identity.reply_to && identity.reply_to !== identity.email);

        const label = identity.name.trim() || acc.display_name.trim() || identity.email;
        const accountLabel = acc.display_name.trim() || acc.email;
        const ambiguousAccountName = accounts.some((other) => other.id !== acc.id
          && sameText(other.display_name.trim() || other.email, accountLabel));
        const accountSource = ambiguousAccountName ? acc.email : accountLabel;
        const metaParts: string[] = sameText(label, identity.email) ? [] : [`<${identity.email}>`];
        if (accounts.length > 1) {
          // The address already identifies ordinary senders. Only add an
          // account source when it supplies distinct context for an alias.
          if (!sameText(accountSource, label) && !sameText(accountSource, identity.email)) {
            metaParts.push(accountSource);
          }
        }
        if (hasDistinctReplyTo) {
          metaParts.push(`回复至: ${identity.reply_to}`);
        } else if (isDefault && (hasDistinctName || hasDistinctEmail)) {
          metaParts.push('默认身份');
        }

        options.push({
          value: `identity:${identity.id}`,
          label,
          meta: metaParts.join(' · ') || undefined,
        });
      }
    }
  }

  const selectedValue = selectedIdentity
    ? `identity:${selectedIdentity.id}`
    : selectedAccount
      ? (availableIdentities.length > 0 && availableIdentities[0]
        ? `identity:${availableIdentities[0].id}`
        : `account:${selectedAccount.id}`)
      : options[0]?.value ?? '';
  const selectedOption = options.find((option) => option.value === selectedValue);

  return (
    <section className="composer-sender-context" aria-label="发件人信息">
      <span className="composer-sender-heading">发件人</span>
      <div
        className="composer-sender-selectors"
        title={selectedOption ? [selectedOption.label, selectedOption.meta].filter(Boolean).join(' ') : undefined}
      >
        <CustomSelect
          active={active}
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
              const matchedIdentity = identities.find((i) => i.id === nextId);
              onPatchDraft({
                account_id: matchedIdentity ? matchedIdentity.account_id : accountId,
                identity_id: nextId,
              });
            }
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
  saveDraftBlockedReason,
  saveDraftFeedback,
  signature = '',
  onInsertSignature,
  onOpenTemplates,
}: ComposerAdvancedToolsProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const saveEntryRef = useRef<HTMLButtonElement | null>(null);
  const templateNameRef = useRef<HTMLInputElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [retainedMode, setRetainedMode] = useState(mode);
  if (mode && mode !== retainedMode) setRetainedMode(mode);
  const presentationMode = mode ?? retainedMode;
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [templateSaveError, setTemplateSaveError] = useState<string | null>(null);
  const saveFeedbackId = useId();
  const templateFeedbackId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useWheelContainment(popoverRef, Boolean(mode));
  const present = usePopoverPresence(popoverRef, Boolean(mode));

  useLayoutEffect(() => {
    if (!mode) return undefined;
    const update = () => {
      const next = clampPosition(anchorRef?.current ?? null, popoverRef.current);
      setPosition((current) => current?.top === next?.top && current?.left === next?.left ? current : next);
    };
    update();
    // Font scaling and late content can resize a portal without changing any
    // React dependency or the viewport. Keep its measured box at the anchor.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (popoverRef.current) observer?.observe(popoverRef.current);
    if (anchorRef?.current) observer?.observe(anchorRef.current);
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
    };
  }, [anchorRef, mode, saveDialogOpen, templates.length, saveDraftBlockedReason, saveDraftFeedback?.message, templateSaveError]);

  useEffect(() => {
    if (!mode) return undefined;
    const focusTarget = saveDialogOpen
      ? templateNameRef.current
      : popoverRef.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')
        ?? saveEntryRef.current;
    focusTarget?.focus({ preventScroll: true });
  }, [mode, saveDialogOpen]);

  useEffect(() => {
    if (!mode || saveDraftPending || document.activeElement !== document.body) return;
    popoverRef.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [mode, saveDraftPending]);

  useEffect(() => {
    if (!mode) return undefined;
    function closeOnPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && (popoverRef.current?.contains(target) || anchorRef?.current?.contains(target))) return;
      if (saveDraftPending) return;
      closeRef.current();
    }
    function closeOnKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (saveDraftPending) return;
        if (saveDialogOpen) setSaveDialogOpen(false);
        else closeRef.current();
        return;
      }
      if (saveDialogOpen || (mode !== 'more' && mode !== 'templates')) return;
      const items = Array.from(popoverRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? []);
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
  }, [anchorRef, mode, saveDialogOpen, saveDraftPending]);

  useEffect(() => {
    if (present) return;
    setSaveDialogOpen(false);
    setTemplateSaveError(null);
    setRetainedMode(null);
  }, [present]);

  if (!present || !presentationMode) return null;

  const templateItems = templates.slice().sort((left, right) => (
    Date.parse(right.updated_at) - Date.parse(left.updated_at)
  )).slice(0, 6);

  const popover = (
    <div
      ref={popoverRef}
      className={`composer-advanced-popover composer-${presentationMode}-popover`}
      style={{ top: position?.top ?? -10000, left: position?.left ?? -10000 }}
      role={presentationMode === 'more' ? 'menu' : 'dialog'}
      aria-label={presentationMode === 'more' ? '更多写信工具' : '邮件模板'}
      aria-hidden={!mode || undefined}
      {...(!mode ? { inert: '' } : {})}
    >
      {presentationMode === 'templates' && <header>
        <strong>模板</strong>
        <button type="button" aria-label="关闭浮层" title="关闭" disabled={saveDraftPending} onClick={onClose}><X size={16} /></button>
      </header>}

      {presentationMode === 'templates' ? (
        <>
          {templateItems.length === 0 ? (
            <div className="composer-template-empty">
              <FileText size={18} aria-hidden="true" />
              <span>暂无模板</span>
              <small>保存一封常用邮件，之后可以快速套用。</small>
            </div>
          ) : (
            <div className="composer-template-list" role="menu" aria-label="最近使用模板">
              {templateItems.map((template) => (
                <div className="composer-template-row" key={template.id}>
                  <button
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
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button ref={saveEntryRef} type="button" className="composer-template-save-entry" onClick={() => { setTemplateSaveError(null); setSaveDialogOpen(true); }}>
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
                  aria-describedby={templateSaveError ? templateFeedbackId : undefined}
                  value={templateName}
                  onChange={(event) => { setTemplateSaveError(null); onTemplateNameChange(event.target.value); }}
                  placeholder="例如：项目周报"
                />
              </label>
              {templateSaveError && <p id={templateFeedbackId} className="composer-save-feedback" role="alert">{templateSaveError}</p>}
              <footer>
                <button type="button" onClick={() => setSaveDialogOpen(false)}>取消</button>
                <button
                  type="button"
                  className="is-primary"
                  disabled={!templateName.trim()}
                  onClick={() => {
                    try {
                      const result = onSaveTemplate();
                      if (result && result.status !== 'saved') {
                        setTemplateSaveError(result.message);
                        templateNameRef.current?.focus({ preventScroll: true });
                        return;
                      }
                      setSaveDialogOpen(false);
                      onClose();
                    } catch (error) {
                      const message = error instanceof Error ? error.message : String(error).replace(/^Error:\s*/i, '');
                      setTemplateSaveError(`模板未保存：${message}`);
                      templateNameRef.current?.focus({ preventScroll: true });
                    }
                  }}
                >
                  <Check size={16} aria-hidden="true" />保存
                </button>
              </footer>
            </div>
          )}
        </>
      ) : (
        <div className="composer-more-menu" role="presentation">
          {onSaveDraft ? (
            <button
              type="button"
              role="menuitem"
              disabled={saveDraftPending || Boolean(saveDraftBlockedReason)}
              aria-busy={saveDraftPending || undefined}
              aria-describedby={saveDraftBlockedReason || saveDraftFeedback ? saveFeedbackId : undefined}
              onClick={() => { void onSaveDraft(); }}
            >
              {saveDraftPending
                ? <LoaderCircle className="spinning" size={14} aria-hidden="true" />
                : <Save size={14} aria-hidden="true" />}
              {saveDraftPending ? '正在保存…' : '保存并关闭'}
            </button>
          ) : null}
          {onInsertSignature ? (
            <button
              type="button"
              role="menuitem"
              disabled={saveDraftPending || !signature.trim()}
              title={!signature.trim() ? '当前发件身份未设置签名' : undefined}
              onClick={() => {
                onInsertSignature();
                onClose();
              }}
            >
              <FileSignature size={14} aria-hidden="true" />插入签名
            </button>
          ) : null}
          {onOpenTemplates ? (
            <button type="button" role="menuitem" disabled={saveDraftPending} onClick={onOpenTemplates}>
              <FileText size={14} aria-hidden="true" />插入模板…
            </button>
          ) : null}
          {!onSaveDraft && !onInsertSignature && !onOpenTemplates ? (
            <span className="composer-more-empty">暂无其他写信工具</span>
          ) : null}
          {(saveDraftBlockedReason || saveDraftFeedback) && (
            <p id={saveFeedbackId} className="composer-save-feedback" role={saveDraftFeedback?.error ? 'alert' : 'status'}>
              {saveDraftBlockedReason || saveDraftFeedback?.message}
            </p>
          )}
        </div>
      )}
    </div>
  );

  return createPortal(popover, document.body);
}
