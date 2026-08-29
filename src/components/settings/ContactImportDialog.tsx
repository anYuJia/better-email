import { createPortal } from 'react-dom';
import {
  Check,
  FileUp,
  History,
  LoaderCircle,
  Pencil,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type {
  ContactImportCommitSummary,
  ContactImportEntryEdit,
  ContactImportPreview,
  ContactImportPreviewEntry,
} from '../../app/types/contact';
import {
  formatContactAliasIssues,
  isValidEmailAddress,
  normalizeContactAliases,
  validateContactAliases,
} from '../../app/uiConfig';
import {
  importSelectionKey,
  type ImportEntryEditMap,
  type ImportSelectionMap,
} from '../../hooks/useContactImportManager';
import {
  CustomSelect,
  customSelectPortalLayers,
} from './accounts/CustomSelect';
import SettingsButton from './shared/SettingsButton';
import { SettingsSwitch } from './shared';

type ContactImportDialogProps = {
  open: boolean;
  preview: ContactImportPreview | null;
  commitResult: ContactImportCommitSummary | null;
  selectionMap: ImportSelectionMap;
  entryEdits: ImportEntryEditMap;
  previewing: boolean;
  importing: boolean;
  importError: string | null;
  onSetSelection: (key: string, action: 'create' | 'merge' | 'skip') => void;
  onSetAllSelection: (action: 'create' | 'merge' | 'skip') => void;
  onSetEntryEdit: (key: string, edit: ContactImportEntryEdit) => void;
  onPickFile: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onOpenHistory: () => void;
};

type DraftEdit = {
  name: string;
  email: string;
  aliasesText: string;
  vip: boolean;
};

const statusLabel: Record<ContactImportPreviewEntry['status'], string> = {
  new: '新增',
  merge: '合并',
  duplicate: '重复',
  invalid: '无效',
};

function formatLabel(format: string): string {
  if (format === 'csv') return 'CSV';
  if (format === 'xlsx') return 'Excel';
  return 'vCard';
}

function defaultActionFor(status: string): 'create' | 'merge' | 'skip' {
  if (status === 'merge') return 'merge';
  if (status === 'duplicate' || status === 'invalid') return 'skip';
  return 'create';
}

function draftFromEntry(entry: ContactImportPreviewEntry, edit: ContactImportEntryEdit | undefined): DraftEdit {
  return {
    name: edit?.name ?? entry.name,
    email: edit?.email ?? entry.email,
    aliasesText: (edit?.aliases ?? entry.aliases).join(', '),
    vip: edit?.vip ?? entry.vip,
  };
}

export default function ContactImportDialog({
  open,
  preview,
  commitResult,
  selectionMap,
  entryEdits,
  previewing,
  importing,
  importError,
  onSetSelection,
  onSetAllSelection,
  onSetEntryEdit,
  onPickFile,
  onConfirm,
  onCancel,
  onOpenHistory,
}: ContactImportDialogProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftEdit | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  /**
   * CustomSelect menus render into document.body. This stable owner lets the
   * modal's focus trap treat those menus as part of this dialog's focus scope.
   */
  const portalOwnerId = useId();
  /** 打开时记录触发元素，关闭后恢复焦点（导入联系人按钮等）。 */
  const focusRestoreRef = useRef<HTMLElement | null>(null);
  /** importing 在 keydown 监听里通过 ref 读取，避免反复重建监听。 */
  const importingRef = useRef(importing);
  importingRef.current = importing;

  // 初始焦点进入弹窗（预览态优先关闭按钮）；关闭时恢复焦点到触发元素。
  useEffect(() => {
    if (!open) return undefined;
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement
      && !activeElement.closest('.contact-import-dialog')
    ) {
      focusRestoreRef.current = activeElement;
    }
    const dialog = dialogRef.current;
    if (dialog) {
      const closeButton = dialog.querySelector<HTMLElement>('.contact-import-close');
      const firstFocusable = dialog.querySelector<HTMLElement>(
        'button:not([disabled]), input, select, textarea',
      );
      (closeButton ?? firstFocusable)?.focus();
    }
    return () => {
      focusRestoreRef.current?.focus();
      focusRestoreRef.current = null;
    };
  }, [open]);

  // Native file picking and import completion replace controls in-place. If
  // the focused button disappeared or became disabled, move focus back to a
  // valid element in the currently visible dialog state.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const active = document.activeElement as HTMLElement | null;
    const activeIsUsable = Boolean(
      active
      && active.isConnected
      && dialog.contains(active)
      && !active.hasAttribute('disabled'),
    );
    if (activeIsUsable) return;
    const focusTarget = dialog.querySelector<HTMLElement>(
      '.contact-import-close:not([disabled]), button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    );
    focusTarget?.focus();
  }, [open, preview, commitResult, previewing, importing]);

  // Tab / Shift+Tab 焦点循环；Escape 关闭（导入提交期间不得误关闭）。
  // CustomSelect menus are body portals, so include only the portals owned by
  // this dialog in the focusable set and in the contains check below.
  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const focusableSelector = 'button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const ownedPortals = () => Array.from(
      document.querySelectorAll<HTMLElement>('[data-portal-owner]'),
    ).filter((element) => element.getAttribute('data-portal-owner') === portalOwnerId);
    const focusables = () => {
      const insideDialog = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      const insideOwnedPortals = ownedPortals().flatMap((portal) => (
        Array.from(portal.querySelectorAll<HTMLElement>(focusableSelector))
      ));
      return [...insideDialog, ...insideOwnedPortals].filter((element) => (
        !element.hasAttribute('disabled')
        && !element.hidden
        && element.getAttribute('aria-hidden') !== 'true'
      ));
    };
    const isInFocusScope = (active: HTMLElement | null) => (
      Boolean(active)
      && (
        dialog.contains(active)
        || ownedPortals().some((portal) => portal.contains(active))
      )
    );
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!importingRef.current) onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusables();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!isInFocusScope(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel, portalOwnerId]);

  if (!open) return null;

  const selectedCount = preview
    ? preview.entries.filter((entry) => {
      if (entry.status === 'invalid') {
        const edit = entryEdits[importSelectionKey(entry.email, entry.status)];
        if (!edit || !isValidEmailAddress(edit.email)) return false;
      }
      const action = selectionMap[importSelectionKey(entry.email, entry.status)]
        ?? defaultActionFor(entry.status);
      return action !== 'skip';
    }).length
    : 0;

  function openEditor(entry: ContactImportPreviewEntry, key: string) {
    setEditingKey(key);
    setDraft(draftFromEntry(entry, entryEdits[key]));
  }

  function saveDraft(key: string, entry: ContactImportPreviewEntry) {
    if (!draft) return;
    const email = draft.email.trim().toLowerCase();
    if (!isValidEmailAddress(email)) return;
    const aliases = normalizeContactAliases(draft.aliasesText)
      .filter((alias) => alias !== email && isValidEmailAddress(alias));
    onSetEntryEdit(key, {
      name: draft.name.trim(),
      email,
      aliases,
      vip: draft.vip,
    });
    setEditingKey(null);
    setDraft(null);
    if (entry.status === 'invalid' && !selectionMap[importSelectionKey(entry.email, entry.status)]) {
      onSetSelection(key, 'create');
    }
  }

  const aliasIssues = draft
    ? validateContactAliases(draft.aliasesText, draft.email, new Set())
    : undefined;
  const aliasIssueText = aliasIssues ? formatContactAliasIssues(aliasIssues) : '';

  return createPortal(
    <div
      className="settings-backdrop contact-import-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !importing) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="contact-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-import-title"
        aria-busy={previewing || importing || undefined}
      >
        {preview ? (
          <div className="contact-import-step">
            <header className="contact-import-dialog-header">
              <span className="contact-import-dialog-mark">
                <FileUp size={18} />
              </span>
              <span className="contact-import-dialog-heading">
                <strong id="contact-import-title">导入预览</strong>
                <small>
                  {preview.file_name} · {formatLabel(preview.format)} 文件
                </small>
              </span>
              <span className="contact-import-counts">
                <em className="count-new">新增 {preview.new_count}</em>
                <em className="count-merge">合并 {preview.merge_count}</em>
                <em className="count-duplicate">重复 {preview.duplicate_count}</em>
                <em className="count-invalid">无效 {preview.invalid_count}</em>
              </span>
              <button
                className="contact-import-close"
                type="button"
                title="关闭"
                aria-label="关闭导入预览"
                disabled={importing}
                onClick={onCancel}
              >
                <X size={16} />
              </button>
            </header>

            <div className="contact-import-selection-toolbar">
              <span>批量选择：</span>
              <SettingsButton size="sm" disabled={importing} onClick={() => onSetAllSelection('create')}>全部新增</SettingsButton>
              <SettingsButton size="sm" disabled={importing} onClick={() => onSetAllSelection('merge')}>全部合并</SettingsButton>
              <SettingsButton size="sm" disabled={importing} onClick={() => onSetAllSelection('skip')}>全部跳过</SettingsButton>
              <span className="contact-import-edit-hint">点击行内铅笔图标可修改名称、邮箱、别名</span>
            </div>

            <div className="contact-import-preview-list">
              {preview.entries.map((entry) => {
                const key = importSelectionKey(entry.email, entry.status);
                const edit = entryEdits[key];
                const isEditing = editingKey === key;
                const editFixedEmail = edit && isValidEmailAddress(edit.email);
                return (
                  <div className="contact-import-preview-row" key={key}>
                    {isEditing ? (
                      <div className="contact-import-entry-editor">
                        <label className="st-field">
                          <span className="st-field-label">联系人名称</span>
                          <input
                            value={draft?.name ?? ''}
                            disabled={importing}
                            onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)}
                            placeholder="联系人名称"
                          />
                        </label>
                        <label className="st-field">
                          <span className="st-field-label">邮箱地址</span>
                          <input
                            value={draft?.email ?? ''}
                            disabled={importing}
                            onChange={(event) => setDraft((current) => current ? { ...current, email: event.target.value } : current)}
                            placeholder="邮箱地址"
                          />
                          {draft && !isValidEmailAddress(draft.email) && (
                            <span className="st-field-error">请输入有效的邮箱地址</span>
                          )}
                        </label>
                        <label className="st-field">
                          <span className="st-field-label">别名邮箱</span>
                          <textarea
                            value={draft?.aliasesText ?? ''}
                            disabled={importing}
                            onChange={(event) => setDraft((current) => current ? { ...current, aliasesText: event.target.value } : current)}
                            placeholder="别名邮箱，逗号、分号或换行分隔"
                          />
                          {aliasIssueText && <span className="st-field-hint">{aliasIssueText}</span>}
                        </label>
                        <SettingsSwitch
                          label="设为 VIP"
                          description="可配合通知策略只提醒重要联系人"
                          checked={draft?.vip ?? false}
                          disabled={importing}
                          onChange={(checked) => setDraft((current) => current ? { ...current, vip: checked } : current)}
                        />
                        <div className="st-actions">
                          <SettingsButton size="sm" disabled={importing} onClick={() => { setEditingKey(null); setDraft(null); }}>
                            取消
                          </SettingsButton>
                          <SettingsButton
                            size="sm"
                            variant="primary"
                            disabled={importing || !draft || !isValidEmailAddress(draft.email)}
                            onClick={() => saveDraft(key, entry)}
                          >
                            保存修改
                          </SettingsButton>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className={`contact-import-status ${entry.status}`}>
                          {statusLabel[entry.status]}
                        </span>
                        <span className={`contact-import-identity ${edit ? 'edited' : ''}`}>
                          <strong>{(edit?.name || entry.name) || (edit?.email || entry.email)}</strong>
                          <em>{edit?.email || entry.email}</em>
                          {(entry.status === 'merge' && entry.existing_name) && (
                            <small>已有：{entry.existing_name}</small>
                          )}
                          {entry.status === 'invalid' && entry.reason && (
                            <small>{entry.reason}</small>
                          )}
                          {(edit?.aliases ?? entry.aliases).length > 0 && (
                            <span className="contact-alias-chips">
                              {(edit?.aliases ?? entry.aliases).slice(0, 4).map((alias) => (
                                <span key={alias}>{alias}</span>
                              ))}
                              {(edit?.aliases ?? entry.aliases).length > 4 && (
                                <span>+{(edit?.aliases ?? entry.aliases).length - 4}</span>
                              )}
                            </span>
                          )}
                        </span>
                        <CustomSelect
                          dense
                          ariaLabel={`${entry.name || entry.email} 导入操作`}
                          value={selectionMap[key] ?? defaultActionFor(entry.status)}
                          portalZIndex={customSelectPortalLayers.contactImport}
                          portalOwnerId={portalOwnerId}
                          disabled={importing || (entry.status === 'invalid' && !editFixedEmail)}
                          disabledValues={entry.status === 'new' ? ['merge'] : []}
                          options={[
                            { value: 'create', label: '新增' },
                            { value: 'merge', label: '合并到已有' },
                            { value: 'skip', label: '跳过' },
                          ]}
                          onChange={(nextAction) => onSetSelection(
                            key,
                            nextAction as 'create' | 'merge' | 'skip',
                          )}
                        />
                        <button
                          type="button"
                          className="contact-import-edit-entry"
                          title="编辑此条目"
                          aria-label={`编辑 ${entry.name || entry.email}`}
                          disabled={importing}
                          onClick={() => openEditor(entry, key)}
                        >
                          <Pencil size={13} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <footer className="contact-import-dialog-actions">
              <SettingsButton icon={<X size={14} />} onClick={onCancel} disabled={importing}>
                取消
              </SettingsButton>
              <SettingsButton
                variant="primary"
                icon={importing ? <LoaderCircle className="spinning" size={14} /> : <Check size={14} />}
                onClick={onConfirm}
                disabled={importing}
              >
                {importing ? '正在导入…' : `确认导入（${selectedCount} 条）`}
              </SettingsButton>
            </footer>
            {importError && (
              <div className="contact-import-error" role="alert">
                <strong>导入失败</strong>
                <p>{importError}</p>
                <small>可以重试确认导入，或取消后重新选择文件。</small>
              </div>
            )}
          </div>
        ) : commitResult ? (
          <div className="contact-import-step contact-import-result">
            <span className="contact-import-dialog-mark success">
              <Check size={20} />
            </span>
            <strong id="contact-import-title">导入完成</strong>
            <p>
              新增 {commitResult.created} 位联系人，合并 {commitResult.merged} 位，
              跳过 {commitResult.skipped} 位。
            </p>
            <p>标记为“重复”的条目已跳过，原有联系人不会重复创建；联系人列表按最近导入/使用时间排序，不按文件原始顺序显示。</p>
            <p>新增的联系人可在「最近导入记录」中一键撤销。</p>
            <div className="contact-import-dialog-actions">
              <SettingsButton icon={<History size={14} />} onClick={onOpenHistory}>
                查看导入记录
              </SettingsButton>
              <SettingsButton variant="primary" onClick={onCancel}>
                完成
              </SettingsButton>
            </div>
          </div>
        ) : (
          <div className="contact-import-step contact-import-idle">
            <span className="contact-import-dialog-mark">
              <FileUp size={20} />
            </span>
            <strong id="contact-import-title">导入联系人</strong>
            <p>
              支持 vCard（.vcf / .vcard）、CSV（.csv）和 Excel（.xlsx / .xlsm）文件，单个文件最大 5 MB。
            </p>
            <p>CSV / Excel 会按表头识别姓名和邮箱列（支持 name / 姓名、email / 邮箱）；没有姓名时使用邮箱作为名称。vCard 中的多个邮箱会按 PREF 标记选择主邮箱。</p>
            {importError && (
              <div className="contact-import-error" role="alert">
                <strong>无法导入该文件</strong>
                <p>{importError}</p>
                <small>可重新选择文件重试，或取消本次导入。</small>
              </div>
            )}
            <div className="contact-import-dialog-actions">
              <SettingsButton icon={<X size={14} />} onClick={onCancel}>
                取消
              </SettingsButton>
              <SettingsButton
                variant="primary"
                icon={previewing ? <LoaderCircle className="spinning" size={14} /> : <FileUp size={14} />}
                onClick={onPickFile}
                disabled={previewing}
              >
                {previewing ? '正在读取文件…' : importError ? '重新选择文件' : '选择文件'}
              </SettingsButton>
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
