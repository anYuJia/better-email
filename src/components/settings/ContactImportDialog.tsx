import { createPortal } from 'react-dom';
import {
  Check,
  FileUp,
  History,
  LoaderCircle,
  Pencil,
  X,
} from 'lucide-react';
import { useState } from 'react';
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
import { CustomSelect } from './accounts/CustomSelect';
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
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !importing) onCancel();
      }}
    >
      <section
        className="contact-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-import-title"
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
              <SettingsButton size="sm" onClick={() => onSetAllSelection('create')}>全部新增</SettingsButton>
              <SettingsButton size="sm" onClick={() => onSetAllSelection('merge')}>全部合并</SettingsButton>
              <SettingsButton size="sm" onClick={() => onSetAllSelection('skip')}>全部跳过</SettingsButton>
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
                            onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)}
                            placeholder="联系人名称"
                          />
                        </label>
                        <label className="st-field">
                          <span className="st-field-label">邮箱地址</span>
                          <input
                            value={draft?.email ?? ''}
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
                            onChange={(event) => setDraft((current) => current ? { ...current, aliasesText: event.target.value } : current)}
                            placeholder="别名邮箱，逗号、分号或换行分隔"
                          />
                          {aliasIssueText && <span className="st-field-hint">{aliasIssueText}</span>}
                        </label>
                        <SettingsSwitch
                          label="设为 VIP"
                          description="可配合通知策略只提醒重要联系人"
                          checked={draft?.vip ?? false}
                          onChange={(checked) => setDraft((current) => current ? { ...current, vip: checked } : current)}
                        />
                        <div className="st-actions">
                          <SettingsButton size="sm" onClick={() => { setEditingKey(null); setDraft(null); }}>
                            取消
                          </SettingsButton>
                          <SettingsButton
                            size="sm"
                            variant="primary"
                            disabled={!draft || !isValidEmailAddress(draft.email)}
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
                          disabled={entry.status === 'invalid' && !editFixedEmail}
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
            <p>CSV / Excel 请使用 name、email 表头；vCard 中的多个邮箱会按 PREF 标记选择主邮箱。</p>
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
                选择文件
              </SettingsButton>
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
