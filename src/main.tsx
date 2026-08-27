import React from 'react';
import { createRoot } from 'react-dom/client';
import AppRoot from './app/AppRoot';
import AppErrorBoundary from './components/AppErrorBoundary';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AppRoot />
    </AppErrorBoundary>
  </React.StrictMode>,
);
