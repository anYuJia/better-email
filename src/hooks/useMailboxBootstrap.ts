import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { loadMailboxMessageLimit } from '../app/mailboxListState';
import type {
  AccountScope,
  FilterMode,
  ListSort,
} from '../app/types';
import type { MailboxDataController } from './useMailboxData';

type UseMailboxBootstrapOptions = {
  accountScope: AccountScope;
  /** Increments for every explicit account-scope selection, including same-scope reselects. */
  scopeRevision?: number;
  folderId: number | null;
  appliedQuery: string;
  filter: FilterMode;
  listSort: ListSort;
  mailboxListStateKey: string;
  mailboxRefreshRef: MutableRefObject<number>;
  navigationScopeClaimRef: MutableRefObject<AccountScope | null>;
  skipNextFolderEffectLoadRef: MutableRefObject<boolean>;
  refreshMailbox: MailboxDataController['refreshMailbox'];
  loadMessages: MailboxDataController['loadMessages'];
  setAccountScope: Dispatch<SetStateAction<AccountScope>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

/**
 * Owns the initial mailbox load and folder-driven list refresh.
 *
 * The scope claim makes the mount effect idempotent when React StrictMode
 * replays effects. The folder skip flag is consumed by the derived folder
 * effect, rather than cleared when refreshMailbox resolves, so React's async
 * state batching cannot turn loadMeta's setFolderId into a duplicate list
 * request after refreshMailbox has already loaded that same folder.
 */
export default function useMailboxBootstrap({
  accountScope,
  scopeRevision = 0,
  folderId,
  appliedQuery,
  filter,
  listSort,
  mailboxListStateKey,
  mailboxRefreshRef,
  navigationScopeClaimRef,
  skipNextFolderEffectLoadRef,
  refreshMailbox,
  loadMessages,
  setAccountScope,
  setStatus,
}: UseMailboxBootstrapOptions) {
  const initializedScopeRef = useRef<{ scope: AccountScope; revision: number } | null>(null);

  useEffect(() => {
    const bootstrapKey = { scope: accountScope, revision: scopeRevision };
    if (navigationScopeClaimRef.current === accountScope) {
      initializedScopeRef.current = bootstrapKey;
      return;
    }
    const initializedScope = initializedScopeRef.current;
    if (
      initializedScope?.scope === accountScope
      && initializedScope.revision === scopeRevision
    ) {
      return;
    }
    initializedScopeRef.current = bootstrapKey;

    // refreshMailbox explicitly loads the resolved folder. Keep this claim
    // until the folder effect observes loadMeta's setFolderId and consumes it.
    skipNextFolderEffectLoadRef.current = true;
    refreshMailbox(accountScope, null)
      .then((resolvedFolderId) => {
        const currentBootstrap = initializedScopeRef.current;
        if (
          currentBootstrap?.scope !== accountScope
          || currentBootstrap.revision !== scopeRevision
        ) {
          return;
        }
        // A scope change can legitimately resolve to the folder that was
        // already selected. In that case React has no folder change to drive
        // the effect below, so release the claim here instead of letting the
        // next filter/sort action consume it by mistake.
        if (
          skipNextFolderEffectLoadRef.current
          && resolvedFolderId === folderId
        ) {
          skipNextFolderEffectLoadRef.current = false;
        }
      })
      .catch((error) => {
        const currentBootstrap = initializedScopeRef.current;
        if (
          currentBootstrap?.scope !== accountScope
          || currentBootstrap.revision !== scopeRevision
        ) {
          return;
        }
        skipNextFolderEffectLoadRef.current = false;
        if (typeof accountScope === 'number') {
          // The remembered account may have been removed. The new scope owns
          // its own bootstrap request on the next effect pass.
          setAccountScope('all');
          return;
        }
        setStatus(String(error));
      });
  }, [accountScope, scopeRevision]);

  useEffect(() => {
    if (!folderId) return;
    if (skipNextFolderEffectLoadRef.current) {
      skipNextFolderEffectLoadRef.current = false;
      return;
    }
    const restoredLimit = loadMailboxMessageLimit(mailboxListStateKey);
    const refreshId = mailboxRefreshRef.current;
    let active = true;
    loadMessages(
      folderId,
      appliedQuery,
      filter,
      accountScope,
      refreshId,
      restoredLimit,
    )
      .then((nextMessages) => {
        // Loading more can leave a count announcement in the global live
        // region. Once navigation commits a different folder/filter/sort,
        // replace that stale message with the result for the current view.
        if (!active || refreshId !== mailboxRefreshRef.current) return;
        setStatus(
          nextMessages.length > 0
            ? `当前列表已显示 ${nextMessages.length} 封邮件`
            : '当前文件夹暂无邮件',
        );
      })
      .catch((error) => {
        if (active && refreshId === mailboxRefreshRef.current) {
          setStatus(String(error));
        }
      });
    return () => {
      active = false;
    };
  }, [folderId, filter, listSort]);
}
