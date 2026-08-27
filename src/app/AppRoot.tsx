import App from '../App';

/**
 * Keep the root entry synchronous.
 *
 * App owns the window-mode routing and imports the shared UI stylesheet, so
 * both the mailbox and the standalone composer receive the same visual system
 * immediately without an extra lazy chunk or first-launch loading surface.
 */
export default function AppRoot() {
  return <App />;
}
