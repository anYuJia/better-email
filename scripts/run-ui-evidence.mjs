process.env.BETTER_EMAIL_UI_EVIDENCE = '1';
process.env.BETTER_EMAIL_UI_CAPTURE_DIR ??= '/tmp/better-email-ui-evidence';
await import('./run-ui-smoke.mjs');
