import { useCallback, useEffect, useRef, useState } from 'react';
import ComposerCloseConfirmDialog from './ComposerCloseConfirmDialog';
import ComposerWindow from './ComposerWindow';
import type {
  Account,
  Contact,
  MailIdentity,
  OutboxItem,
} from '../app/types';
import type { PendingSendUndo } from './UndoSnackbarStack';
import {
  emptyDraft,
  isDraftEmpty,
  loadAccountScope,
  loadSendUndoDelaySeconds,
  normalizeDraftInput,
} from '../app/appConfig';
import type { FolderRole } from '../app/types';
import {
  closeCurrentWindow,
  COMPOSER_CLOSED_EVENT,
  COMPOSER_CONTACTS_SETTINGS_EVENT,
  COMPOSER_OPEN_EVENT,
  emitToMain,
  invoke,
  listenCurrentWindow,
  onCurrentWindowCloseRequested,
  showCurrentWindow,
  takePendingComposerRequest,
  type ComposerWindowRequest,
} from '../tauriBridge';
import { IPC } from '../ipc/commands';
import useComposerController from '../hooks/useComposerController';
import useThemeMode from '../hooks/useThemeMode';

function normalizeComposerRequest(value: unknown): ComposerWindowRequest | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const draft = normalizeDraftInput(record.draft);
  return {
    draft: draft ?? undefined,
    restoreAutosave: record.restoreAutosave === true,
    replaceExisting: record.replaceExisting === true,
  };
}

export default function StandaloneComposerApp() {
  useThemeMode();

  const [account, setAccount] = useState<Account | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [identities, setIdentities] = useState<MailIdentity[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [, setOutbox] = useState<OutboxItem[]>([]);
  const [pendingSendUndo, setPendingSendUndo] = useState<PendingSendUndo | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [status, setStatus] = useState('正在准备写信窗口…');
  const [booted, setBooted] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [composerSendProgress, setComposerSendProgress] = useState<number | null>(null);
  const [composerSendProgressMessage, setComposerSendProgressMessage] = useState<string | null>(null);
  const [composerAttachmentProgress, setComposerAttachmentProgress] = useState<number | null>(null);
  const closingRef = useRef(false);
  const bootedRef = useRef(false);
  const closeComposerRef = useRef<() => void>(() => {});
  const draftRef = useRef(emptyDraft);
  const isPrewarmedWindow = new URLSearchParams(window.location.search).get('prewarm') === '1';
  const applyComposerRequestRef = useRef<(
    request: ComposerWindowRequest | null,
    restoreWhenMissing?: boolean,
  ) => void>(() => {});

  const loadComposerData = useCallback(async (preferredAccountId?: number) => {
    const nextAccounts = await invoke<Account[]>(IPC.ListAccounts);
    const storedScope = loadAccountScope();
    const requestedAccountId = preferredAccountId && preferredAccountId > 0
      ? preferredAccountId
      : typeof storedScope === 'number'
        ? storedScope
        : null;
    const [nextAccount, nextContacts, nextIdentities] = await Promise.all([
      invoke<Account | null>(IPC.GetAccount, { accountId: requestedAccountId }),
      invoke<Contact[]>(IPC.ListContacts),
      invoke<MailIdentity[]>(IPC.ListIdentities, { accountId: requestedAccountId }),
    ]);
    const fallbackAccount = nextAccounts.find((entry) => entry.is_default) ?? nextAccounts[0] ?? null;
    setAccounts(nextAccounts);
    setAccount(nextAccount ?? fallbackAccount);
    setContacts(nextContacts);
    setIdentities(nextIdentities);
  }, []);

  const loadMeta = useCallback(async (_folderId?: number | null) => {
    await loadComposerData();
    return { folderId: null, folders: [] };
  }, [loadComposerData]);

  const refreshAll = useCallback(async () => {
    await loadComposerData();
  }, [loadComposerData]);

  const focusMailboxRole = useCallback(async (
    _role: FolderRole,
    _targetAccountId: number | null,
    statusMessage: string,
  ) => {
    setStatus(statusMessage);
  }, []);

  const showToast = useCallback((text: string) => {
    setStatus(text);
  }, []);

  const {
    draft,
    setDraft,
    isRichComposer,
    composeTemplates,
    templateName,
    setTemplateName,
    composerAutosave,
    isComposerOpen,
    isComposerMinimized,
    isComposerDropActive,
    composerFocusRequest,
    openComposer,
    closeComposer,
    forceCloseComposer,
    clearComposerAutosave,
    insertSignatureIntoDraft,
    applyComposeTemplate,
    saveDraftAsTemplate,
    deleteComposeTemplate,
    pickDraftAttachments,
    buildInlineImageAttachments,
    addInlineImages,
    handleComposerAttachmentDrop,
    handleComposerAttachmentPaste,
    handleComposerAttachmentDragOver,
    handleComposerAttachmentDragEnter,
    handleComposerAttachmentDragLeave,
    removeDraftAttachment,
    addContactsToDraft,
    saveDraft,
    requestSend,
    confirmSendRisk,
    sendRiskConfirm,
    setSendRiskConfirm,
    crossAccountRisks,
    queueDraft,
    composerCloseConfirmOpen,
    setComposerCloseConfirmOpen,
  } = useComposerController({
    account,
    accounts,
    identities,
    selectedId,
    pendingSendUndo,
    sendUndoDelaySeconds: loadSendUndoDelaySeconds(),
    setOutbox,
    setPendingSendUndo,
    setSelectedId,
    setStatus,
    showToast,
    loadMeta,
    refreshAll,
    focusMailboxRole,
    setSendProgress: setComposerSendProgress,
    setSendProgressMessage: setComposerSendProgressMessage,
    setAttachmentProgress: setComposerAttachmentProgress,
  });

  closeComposerRef.current = closeComposer;
  draftRef.current = draft;

  const applyComposerRequest = useCallback((request: ComposerWindowRequest | null, restoreWhenMissing = false) => {
    if (request) {
      openComposer(request.draft, {
        restoreAutosave: request.restoreAutosave,
        replaceExisting: request.replaceExisting,
      });
      return;
    }
    openComposer(undefined, restoreWhenMissing ? { restoreAutosave: true } : {});
  }, [openComposer]);
  // Draft edits change the controller callback identity. Keep boot and IPC listeners
  // stable so a body edit cannot re-run initialization and steal focus from the editor.
  applyComposerRequestRef.current = applyComposerRequest;

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const register = async () => {
      try {
        const nextUnlisten = await listenCurrentWindow<unknown>(COMPOSER_OPEN_EVENT, () => {
          if (!bootedRef.current) return;
          closingRef.current = false;
          takePendingComposerRequest()
            .then((value) => {
              if (!active) return;
              const request = normalizeComposerRequest(value);
              applyComposerRequestRef.current(request);
              window.requestAnimationFrame(() => {
                void showCurrentWindow();
              });
              void loadComposerData(request?.draft?.account_id || undefined).catch(() => undefined);
            })
            .catch((error) => setStatus(`读取写信请求失败：${String(error)}`));
        });
        if (active) unlisten = nextUnlisten;
        else nextUnlisten();
      } catch (error) {
        if (active) setStatus(`独立写信窗口通信失败：${String(error)}`);
      }
    };
    void register();
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const boot = async () => {
      try {
        const pending = normalizeComposerRequest(await takePendingComposerRequest());
        await loadComposerData(pending?.draft?.account_id || undefined);
        if (!active) return;
        if (pending || !isPrewarmedWindow) {
          applyComposerRequestRef.current(pending, true);
        }
        bootedRef.current = true;
        setBooted(true);
        if (pending || !isPrewarmedWindow) {
          window.requestAnimationFrame(() => {
            void showCurrentWindow();
          });
        }
      } catch (error) {
        if (!active) return;
        setLoadError(String(error));
      }
    };
    void boot();
    return () => {
      active = false;
    };
  }, [isPrewarmedWindow, loadComposerData]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const register = async () => {
      try {
        const nextUnlisten = await onCurrentWindowCloseRequested((event) => {
          if (closingRef.current) return;
          event.preventDefault();
          if (isDraftEmpty(draftRef.current)) {
            closingRef.current = true;
            emitToMain(COMPOSER_CLOSED_EVENT)
              .catch(() => undefined)
              .finally(() => {
                closeCurrentWindow().catch(() => undefined);
              });
            return;
          }
          closeComposerRef.current();
        });
        if (active) unlisten = nextUnlisten;
        else nextUnlisten();
      } catch (error) {
        if (active) setStatus(`窗口关闭监听失败：${String(error)}`);
      }
    };
    void register();
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!booted || isComposerOpen || closingRef.current) return;
    closingRef.current = true;
    emitToMain(COMPOSER_CLOSED_EVENT)
      .catch(() => undefined)
      .finally(() => {
        closeCurrentWindow().catch(() => undefined);
      });
  }, [booted, isComposerOpen]);

  const openContactsSettings = useCallback(() => {
    void (async () => {
      try {
        if (isDraftEmpty(draft)) {
          forceCloseComposer();
        } else {
          await saveDraft();
        }
        await emitToMain(COMPOSER_CONTACTS_SETTINGS_EVENT);
      } catch (error) {
        setStatus(String(error));
      }
    })();
  }, [draft, forceCloseComposer, saveDraft, setStatus]);

  if (loadError) {
    return (
      <main className="standalone-composer-app">
        <div className="standalone-composer-status" role="alert">
          <strong>无法打开写信窗口</strong>
          <p>{loadError}</p>
        </div>
      </main>
    );
  }

  if (!booted) {
    return (
      <main className="standalone-composer-app">
        <div className="standalone-composer-status">
          <strong>正在打开写信窗口</strong>
          <p>{status}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="standalone-composer-app">
      {isComposerOpen && (
        <ComposerWindow
          standaloneWindow
          minimized={isComposerMinimized}
          focusRequest={composerFocusRequest}
          draft={draft}
          accounts={accounts}
          identities={identities}
          fallbackAccountId={account?.id ?? accounts[0]?.id ?? 0}
          contacts={contacts}
          onAddContacts={addContactsToDraft}
          onOpenContactsSettings={openContactsSettings}
          templates={composeTemplates}
          templateName={templateName}
          richComposer={isRichComposer}
          dropActive={isComposerDropActive}
          status={status}
          autosave={composerAutosave}
          onMinimize={() => undefined}
          onRestore={() => undefined}
          onClose={closeComposer}
          onDraftChange={setDraft}
          onApplyTemplate={applyComposeTemplate}
          onDeleteTemplate={deleteComposeTemplate}
          onTemplateNameChange={setTemplateName}
          onSaveTemplate={saveDraftAsTemplate}
          onInsertSignature={insertSignatureIntoDraft}
          onPickAttachments={() => {
            pickDraftAttachments().catch((error) => setStatus(String(error)));
          }}
          onRemoveAttachment={removeDraftAttachment}
          onAttachmentDrop={handleComposerAttachmentDrop}
          onAttachmentDragEnter={handleComposerAttachmentDragEnter}
          onAttachmentDragLeave={handleComposerAttachmentDragLeave}
          onAttachmentDragOver={handleComposerAttachmentDragOver}
          onAttachmentPaste={handleComposerAttachmentPaste}
          buildInlineImageAttachments={buildInlineImageAttachments}
          onInlineImagesAdded={addInlineImages}
          onSaveDraft={() => { saveDraft().catch((error) => setStatus(String(error))); }}
          onQueueDraft={() => { queueDraft().catch((error) => setStatus(String(error))); }}
          onSendDraft={() => { requestSend().catch((error) => setStatus(String(error))); }}
          onSendRiskConfirm={confirmSendRisk}
          onSendRiskCancel={() => setSendRiskConfirm(null)}
          sendRiskConfirm={sendRiskConfirm}
          sendProgress={composerSendProgress}
          sendProgressMessage={composerSendProgressMessage}
          attachmentProgress={composerAttachmentProgress}
          crossAccountRisks={crossAccountRisks}
        />
      )}
      {composerCloseConfirmOpen && (
        <ComposerCloseConfirmDialog
          setOpen={setComposerCloseConfirmOpen}
          onClose={() => setComposerCloseConfirmOpen(false)}
          onDiscard={() => {
            setDraft(emptyDraft);
            clearComposerAutosave();
            forceCloseComposer();
          }}
          onSaveDraft={saveDraft}
        />
      )}
    </main>
  );
}
