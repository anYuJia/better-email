import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AppErrorBoundary from './components/AppErrorBoundary';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
