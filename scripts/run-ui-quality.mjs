process.env.BETTER_EMAIL_UI_QUALITY_MATRIX = '1';
process.env.BETTER_EMAIL_UI_CAPTURE_DIR ??= '/tmp/better-email-ui-quality';
await import('./run-ui-smoke.mjs');
