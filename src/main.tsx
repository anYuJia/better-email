import React from 'react';
import { createRoot } from 'react-dom/client';
import AppRoot from './app/AppRoot';
import AppErrorBoundary from './components/AppErrorBoundary';
import { installInputPolicy } from './app/inputPolicy';
import { reportStartupMilestone } from './startupTelemetry';
import './ui-2026.css';

void reportStartupMilestone('main_react_entry');
installInputPolicy();

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AppRoot />
    </AppErrorBoundary>
  </React.StrictMode>,
);
