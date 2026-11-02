process.env.BETTER_EMAIL_UI_ATTACHMENTS = '1';
process.env.BETTER_EMAIL_UI_CAPTURE_DIR ??= '/tmp/better-email-ui-attachments';
await import('./run-ui-smoke.mjs');
