import React from 'react';
import { createRoot } from 'react-dom/client';
import AppRoot from './app/AppRoot';
import AppErrorBoundary from './components/AppErrorBoundary';
import './ui-2026.css';
import './components/composer/composer.css';
import './components/composer/composer-polish.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AppRoot />
    </AppErrorBoundary>
  </React.StrictMode>,
);
