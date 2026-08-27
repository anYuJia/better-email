import React from 'react';
import { createRoot } from 'react-dom/client';
import AppRoot from './app/AppRoot';
import AppErrorBoundary from './components/AppErrorBoundary';
import { installInputPolicy } from './app/inputPolicy';
import './ui-2026.css';

installInputPolicy();

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AppRoot />
    </AppErrorBoundary>
  </React.StrictMode>,
);
