import { lazy, Suspense, useEffect } from 'react';
import DeferredSurface from '../components/DeferredSurface';
import { emptyDraft } from './appConfig';
import { logError } from './logger';
import { importNativeDroppedAttachmentPaths } from './nativeDroppedAttachments';
import {
  getCurrentWindow,
  isStandaloneComposerWindow,
  mockMode,
  openComposerWindow,
} from '../tauriBridge';

const MailboxApp = lazy(() => import('../App'));
const StandaloneComposerApp = lazy(() => import('../components/StandaloneComposerApp'));

function MainWindowFileDropBridge() {
  useEffect(() => {
    if (mockMode) return undefined;
    let active = true;
    let unlisten: (() => void) | undefined;

    void getCurrentWindow().onDragDropEvent((event) => {
      if (!active || event.type !== 'drop') return;
      const paths = event.paths.filter((path) => path.trim());
      if (paths.length === 0) return;

      void (async () => {
        try {
          const result = await importNativeDroppedAttachmentPaths(paths);
          if (!active) return;
          if (result.failed > 0) {
            logError('Main-window native file drop partially failed', {
              failed: result.failed,
              firstError: result.firstError,
            });
          }
          if (result.attachments.length === 0) return;

          await openComposerWindow({
            draft: {
              ...emptyDraft,
              attachments: result.attachments,
            },
            replaceExisting: true,
          });
        } catch (error) {
          logError('Main-window native file drop failed', error);
        }
      })();
    })
      .then((nextUnlisten) => {
        unlisten = nextUnlisten;
      })
      .catch((error) => {
        logError('Main-window native drag/drop listener unavailable', error);
      });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  return null;
}

/**
 * Application entry boundary.
 *
 * Keep window-mode routing outside the mailbox workspace so the standalone
 * composer does not eagerly load the large mailbox application bundle.
 */
export default function AppRoot() {
  const standaloneComposer = isStandaloneComposerWindow();
  const Surface = standaloneComposer ? StandaloneComposerApp : MailboxApp;

  return (
    <>
      {!standaloneComposer ? <MainWindowFileDropBridge /> : null}
      <Suspense
        fallback={(
          <DeferredSurface
            label={standaloneComposer ? '正在准备写信窗口' : '正在准备邮箱工作区'}
          />
        )}
      >
        <Surface />
      </Suspense>
    </>
  );
}
