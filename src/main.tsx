import React from 'react';
import { createRoot } from 'react-dom/client';
import AppErrorBoundary from './components/AppErrorBoundary';
import './ui-2026.css';

const root = createRoot(document.getElementById('root') as HTMLElement);
const isStandaloneComposer = new URLSearchParams(window.location.search).get('window') === 'compose';

async function boot() {
  const Component = isStandaloneComposer
    ? (await import('./components/StandaloneComposerApp')).default
    : (await import('./App')).default;

  root.render(
    <React.StrictMode>
      <AppErrorBoundary>
        <Component />
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}

void boot().catch((error) => {
  console.error('Failed to boot Better Email', error);
  root.render(
    <main className="app-boot-error" role="alert">
      <strong>Better Email 启动失败</strong>
      <p>{String(error)}</p>
    </main>,
  );
});
