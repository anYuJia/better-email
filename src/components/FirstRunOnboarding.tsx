import { useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  FileUp,
  LoaderCircle,
  Mailbox,
  RotateCcw,
  Send,
} from 'lucide-react';
import type { Account } from '../app/types';
import {
  sendUndoDelayOptions,
  type SendUndoDelaySeconds,
} from '../app/appConfig';
import {
  CustomSelect,
  customSelectPortalLayers,
} from './settings/accounts/CustomSelect';
import ContactImportDialog from './settings/ContactImportDialog';
import useContactImportManager from '../hooks/useContactImportManager';
import './first-run-onboarding.css';

type FirstRunOnboardingProps = {
  /** 引导必须显式绑定账号 ID：保存回调不得因账号切换误改另一个账号。 */
  accountId: number;
  account: Account;
  sendUndoDelaySeconds: SendUndoDelaySeconds;
  onAccountSettingsChange: (patch: Partial<Account>) => Promise<void>;
  onSendUndoDelayChange: (seconds: SendUndoDelaySeconds) => void;
  onComplete: () => Promise<void>;
  onSkipAll: () => Promise<void>;
  onStatus: (text: string) => void;
};

type StepId = 'attachments' | 'send-delay' | 'security' | 'contacts';

const stepOrder: StepId[] = ['attachments', 'send-delay', 'security', 'contacts'];

const stepTitles: Record<StepId, string> = {
  attachments: '新邮件附件自动下载',
  'send-delay': '延迟发送',
  security: '邮件安全与内容显示',
  contacts: '导入联系人',
};

function StepToggle({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`onboarding-toggle${disabled ? ' is-disabled' : ''}`}>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export default function FirstRunOnboarding({
  accountId,
  account,
  sendUndoDelaySeconds,
  onAccountSettingsChange,
  onSendUndoDelayChange,
  onComplete,
  onSkipAll,
  onStatus,
}: FirstRunOnboardingProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [failedSave, setFailedSave] = useState<{
    patch: Partial<Account>;
    applyOptimistic: () => void;
  } | null>(null);
  const [autoDownload, setAutoDownload] = useState(account.auto_download_attachments);
  const [sendDelay, setSendDelay] = useState<SendUndoDelaySeconds>(sendUndoDelaySeconds);
  const [hideRemoteImages, setHideRemoteImages] = useState(!account.remote_images_allowed);
  const [hideLinks, setHideLinks] = useState(account.intercept_https_links !== false);
  const [warnExternal, setWarnExternal] = useState(account.warn_external_senders === true);
  const dialogRef = useRef<HTMLElement | null>(null);
  const importButtonRef = useRef<HTMLButtonElement | null>(null);
  const portalOwnerId = useId();

  // 引导期间底层应用 inert：快捷键、写邮件、切换账号、设置均不能穿透。
  // 真实 WindowChrome（Windows/Linux 关闭按钮）保持可点。
  useEffect(() => {
    const overlay = dialogRef.current?.parentElement;
    const parent = overlay?.parentElement;
    if (!overlay || !parent) return undefined;
    const siblings = Array.from(parent.children).filter(
      (element) => element !== overlay && !element.hasAttribute('data-window-chrome'),
    );
    const previousAccessibilityState = new Map<Element, {
      inert: boolean;
      ariaHidden: string | null;
    }>();
    for (const sibling of siblings) {
      previousAccessibilityState.set(sibling, {
        inert: sibling.hasAttribute('inert'),
        ariaHidden: sibling.getAttribute('aria-hidden'),
      });
      sibling.setAttribute('inert', '');
      sibling.setAttribute('aria-hidden', 'true');
    }
    return () => {
      for (const sibling of siblings) {
        const previousState = previousAccessibilityState.get(sibling);
        if (!previousState) continue;
        if (previousState.inert) {
          sibling.setAttribute('inert', '');
        } else {
          sibling.removeAttribute('inert');
        }
        if (previousState.ariaHidden === null) {
          sibling.removeAttribute('aria-hidden');
        } else {
          sibling.setAttribute('aria-hidden', previousState.ariaHidden);
        }
      }
    };
  }, []);

  // 焦点管理：进入时聚焦首可交互元素；Tab 焦点陷阱；Escape 不能绕过引导。
  useEffect(() => {
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
    const firstFocusable = focusables()[0];
    firstFocusable?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // 明确要求：Escape 不得跳过或完成引导。
        event.preventDefault();
        event.stopPropagation();
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
    dialog.addEventListener('keydown', handleKeyDown);
    return () => dialog.removeEventListener('keydown', handleKeyDown);
  }, [portalOwnerId, stepIndex]);

  const {
    preview,
    commitResult,
    selectionMap,
    entryEdits,
    setEntryEdit,
    setSelection,
    setAllSelection,
    previewing,
    importing,
    importError,
    setImportError,
    startImport,
    commitImport,
    cancelImport,
  } = useContactImportManager({ setStatus: (value) => {
    if (typeof value !== 'function') onStatus(value);
  } });
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  // Contact import is a body portal above the onboarding. While it is open,
  // the onboarding itself becomes the inactive layer, not merely a visual
  // backdrop. This keeps Tab and screen readers inside the second-level
  // dialog, then restores the exact prior accessibility state on close.
  useEffect(() => {
    if (!importDialogOpen) return undefined;
    const onboarding = dialogRef.current;
    if (!onboarding) return undefined;
    const wasInert = onboarding.hasAttribute('inert');
    const previousAriaHidden = onboarding.getAttribute('aria-hidden');
    onboarding.setAttribute('inert', '');
    onboarding.setAttribute('aria-hidden', 'true');
    return () => {
      if (wasInert) {
        onboarding.setAttribute('inert', '');
      } else {
        onboarding.removeAttribute('inert');
      }
      if (previousAriaHidden === null) {
        onboarding.removeAttribute('aria-hidden');
      } else {
        onboarding.setAttribute('aria-hidden', previousAriaHidden);
      }
    };
  }, [importDialogOpen]);

  const step = stepOrder[stepIndex];
  const isLastStep = stepIndex === stepOrder.length - 1;

  // 保存失败：显示错误 + 重试入口，并在失败时回滚本地开关状态。
  const applyAccountPatch = async (
    patch: Partial<Account>,
    rollback: () => void,
    applyOptimistic: () => void,
  ) => {
    // 显式绑定引导账号 ID：传入账号与绑定 ID 不一致时拒绝保存，绝不误改其他账号。
    if (account.id !== accountId) {
      const message = `引导绑定账号（ID ${accountId}）与当前账号（ID ${account.id}）不一致，已阻止保存。`;
      setSaveError(message);
      onStatus(message);
      rollback();
      return;
    }
    setSaving(true);
    setSaveError(null);
    setFailedSave(null);
    try {
      await onAccountSettingsChange(patch);
      // 保存成功：本地开关状态与已持久化值保持一致（重试成功后恢复新值）。
      applyOptimistic();
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error))
        .replace(/^Error:\s*/i, '')
        .trim() || '保存设置失败，请重试。';
      setSaveError(message);
      setFailedSave({ patch, applyOptimistic });
      rollback();
      onStatus(`首次引导设置保存失败：${message}`);
    } finally {
      setSaving(false);
    }
  };

  const retryFailedSave = () => {
    if (!failedSave) return;
    const { patch, applyOptimistic } = failedSave;
    setFailedSave(null);
    void applyAccountPatch(patch, () => undefined, applyOptimistic);
  };

  const handleAutoDownloadChange = (checked: boolean) => {
    setAutoDownload(checked);
    void applyAccountPatch(
      { auto_download_attachments: checked },
      () => setAutoDownload(!checked),
      () => setAutoDownload(checked),
    );
  };

  const handleSendDelayChange = (seconds: SendUndoDelaySeconds) => {
    setSendDelay(seconds);
    onSendUndoDelayChange(seconds);
  };

  const handleHideRemoteImagesChange = (checked: boolean) => {
    setHideRemoteImages(checked);
    void applyAccountPatch(
      { remote_images_allowed: !checked },
      () => setHideRemoteImages(!checked),
      () => setHideRemoteImages(checked),
    );
  };

  const handleHideLinksChange = (checked: boolean) => {
    setHideLinks(checked);
    void applyAccountPatch(
      { intercept_https_links: checked },
      () => setHideLinks(!checked),
      () => setHideLinks(checked),
    );
  };

  const handleWarnExternalChange = (checked: boolean) => {
    setWarnExternal(checked);
    void applyAccountPatch(
      { warn_external_senders: checked },
      () => setWarnExternal(!checked),
      () => setWarnExternal(checked),
    );
  };

  // 完成引导（最后一步或跳过全部）：onComplete/onSkipAll 可能触发 IPC 失败。
  // 失败时必须显示可读错误并提供重试，引导不得悄悄消失，
  // 当前步骤与用户已选择的设置必须原样保留。
  const [failedCompletion, setFailedCompletion] = useState<(() => Promise<void>) | null>(null);
  const runCompletion = async (finish: () => Promise<void>) => {
    if (completing) return;
    setCompleting(true);
    setCompletionError(null);
    setFailedCompletion(null);
    try {
      await finish();
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error))
        .replace(/^Error:\s*/i, '')
        .trim() || '保存首次引导设置失败，请重试。';
      setCompletionError(message);
      setFailedCompletion(() => finish);
      onStatus(`首次引导保存失败：${message}`);
    } finally {
      setCompleting(false);
    }
  };

  const goNext = () => {
    if (isLastStep) {
      void runCompletion(onComplete);
      return;
    }
    setStepIndex((current) => current + 1);
  };

  const handleSkipAll = () => {
    void runCompletion(onSkipAll);
  };

  const retryCompletion = () => {
    if (failedCompletion) void runCompletion(failedCompletion);
  };

  const handleOpenImport = () => {
    setSaveError(null);
    setImportError(null);
    setImportDialogOpen(true);
  };

  const handleCloseImport = () => {
    cancelImport();
    setImportDialogOpen(false);
    requestAnimationFrame(() => importButtonRef.current?.focus());
  };

  const importFinished = commitResult != null;

  return (
    <div className="first-run-onboarding-backdrop">
      <section
        className="first-run-onboarding"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-run-onboarding-title"
      >
        <header className="first-run-onboarding-header">
          <span className="first-run-onboarding-mark">
            <Mailbox size={20} />
          </span>
          <span>
            <strong id="first-run-onboarding-title">设置 Better Email</strong>
            <small>{account.email}</small>
          </span>
        </header>

        <div className="first-run-onboarding-progress" aria-hidden="true">
          {stepOrder.map((id, index) => (
            <span
              key={id}
              className={[
                'onboarding-progress-step',
                index < stepIndex ? 'done' : '',
                index === stepIndex ? 'active' : '',
              ].filter(Boolean).join(' ')}
            />
          ))}
        </div>

        <div className="first-run-onboarding-body">
          <span className="onboarding-step-index">
            {stepIndex + 1} / {stepOrder.length}
          </span>
          <h2>{stepTitles[step]}</h2>

          {saveError && (
            <div className="onboarding-save-error" role="alert">
              <AlertCircle size={15} aria-hidden="true" />
              <span>
                <strong>保存失败</strong>
                <small>{saveError}</small>
              </span>
              <button
                type="button"
                className="onboarding-error-retry"
                onClick={retryFailedSave}
                disabled={saving}
              >
                <RotateCcw size={13} />
                重试
              </button>
            </div>
          )}

          {completionError && (
            <div className="onboarding-save-error" role="alert">
              <AlertCircle size={15} aria-hidden="true" />
              <span>
                <strong>完成首次引导失败</strong>
                <small>{completionError}</small>
              </span>
              <button
                type="button"
                className="onboarding-error-retry"
                onClick={retryCompletion}
                disabled={completing}
              >
                <RotateCcw size={13} />
                重试
              </button>
            </div>
          )}

          {step === 'attachments' && (
            <div className="onboarding-step-content">
              <p>
                是否自动下载新接收邮件的附件？
                <small>仅影响此后新到的邮件，不会触发历史全部附件下载。</small>
              </p>
              <StepToggle
                label="自动下载新邮件附件"
                description="开启后，同步时新到达邮件的附件会自动保存到本地。"
                checked={autoDownload}
                disabled={saving}
                onChange={handleAutoDownloadChange}
              />
            </div>
          )}

          {step === 'send-delay' && (
            <div className="onboarding-step-content">
              <p>
                发送邮件后，多久才真正发出？
                <small>倒计时结束后邮件才真正进入待发送队列，到期后发送，期间可随时撤回。</small>
              </p>
              <div className="onboarding-field">
                <span>撤销发送延迟</span>
                <CustomSelect
                  dense
                  ariaLabel="撤销发送延迟"
                  portalZIndex={customSelectPortalLayers.onboarding}
                  portalOwnerId={portalOwnerId}
                  value={String(sendDelay)}
                  options={sendUndoDelayOptions.map((option) => ({
                    value: String(option.value),
                    label: option.label,
                  }))}
                  onChange={(value) => handleSendDelayChange(Number(value) as SendUndoDelaySeconds)}
                />
              </div>
            </div>
          )}

          {step === 'security' && (
            <div className="onboarding-step-content onboarding-security">
              <p>按你的习惯决定邮件内容的安全显示策略，之后可在「设置 → 邮箱账号 → 隐私」中随时修改。</p>
              <StepToggle
                label="隐藏远程图片"
                description="默认阻止邮件中的远程图片，避免追踪像素暴露打开行为。"
                checked={hideRemoteImages}
                disabled={saving}
                onChange={handleHideRemoteImagesChange}
              />
              <StepToggle
                label="隐藏邮件中的链接"
                description="正文链接默认显示为「已隐藏链接」，需要时再手动查看并打开。"
                checked={hideLinks}
                disabled={saving}
                onChange={handleHideLinksChange}
              />
              <StepToggle
                label="提示来自其他邮箱 / 外部发件人的邮件"
                description="开启后，发件人域名与本账号不同的邮件会显示外部来信提示。"
                checked={warnExternal}
                disabled={saving}
                onChange={handleWarnExternalChange}
              />
            </div>
          )}

          {step === 'contacts' && (
            <div className="onboarding-step-content">
              <p>
                可以把其他邮箱的通讯录导入进来。
                <small>支持 vCard、CSV 和 Excel 文件；跳过也不影响进入应用。</small>
              </p>
              <div className="onboarding-contact-actions">
                <button
                  ref={importButtonRef}
                  type="button"
                  className="onboarding-import-button"
                  disabled={previewing || importFinished}
                  onClick={handleOpenImport}
                >
                  {previewing ? <LoaderCircle className="spinning" size={15} /> : <FileUp size={15} />}
                  {importFinished ? `已导入 ${commitResult.created + commitResult.merged} 位联系人` : '导入联系人（上传文件）'}
                </button>
                {importFinished && <span className="onboarding-import-ok"><Check size={13} /> 完成</span>}
              </div>
            </div>
          )}
        </div>

        <footer className="first-run-onboarding-actions">
          <button type="button" className="onboarding-skip-all" onClick={handleSkipAll} disabled={completing}>
            跳过全部
          </button>
          <button
            type="button"
            className="onboarding-primary"
            disabled={saving || completing || (step === 'contacts' && importing)}
            onClick={goNext}
          >
            {completing ? <LoaderCircle className="spinning" size={15} /> : isLastStep ? <Check size={15} /> : <Send size={15} />}
            {isLastStep ? (importFinished ? '完成，进入应用' : '跳过，进入应用') : '下一步'}
          </button>
        </footer>

        {step === 'contacts' && (
          <ContactImportDialog
            open={importDialogOpen}
            preview={preview}
            commitResult={commitResult}
            selectionMap={selectionMap}
            entryEdits={entryEdits}
            previewing={previewing}
            importing={importing}
            importError={importError}
            onSetSelection={(key, action) => setSelection(key, action)}
            onSetAllSelection={setAllSelection}
            onSetEntryEdit={setEntryEdit}
            onPickFile={() => { void startImport(); }}
            onConfirm={() => { void commitImport(); }}
            onCancel={handleCloseImport}
            onOpenHistory={() => {
              handleCloseImport();
              onStatus('导入记录可在「设置 → 效率工具 → 通讯录」中查看');
            }}
          />
        )}
      </section>
    </div>
  );
}
