process.env.BETTER_EMAIL_UI_WORKFLOW = '1';
process.env.BETTER_EMAIL_UI_CAPTURE_DIR ??= '/tmp/better-email-ui-workflow';
await import('./run-ui-smoke.mjs');
