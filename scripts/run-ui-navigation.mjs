process.env.BETTER_EMAIL_UI_NAVIGATION = '1';
process.env.BETTER_EMAIL_UI_CAPTURE_DIR ??= '/tmp/better-email-ui-navigation';
await import('./run-ui-smoke.mjs');
