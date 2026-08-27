import { lazy, Suspense } from 'react';
import DeferredSurface from '../components/DeferredSurface';
import { isStandaloneComposerWindow } from '../tauriBridge';

const MailboxApp = lazy(() => import('../App'));
const StandaloneComposerApp = lazy(() => import('../components/StandaloneComposerApp'));

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
    <Suspense
      fallback={(
        <DeferredSurface
          label={standaloneComposer ? '正在准备写信窗口' : '正在准备邮箱工作区'}
        />
      )}
    >
      <Surface />
    </Suspense>
  );
}
