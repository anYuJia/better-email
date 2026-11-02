process.env.BETTER_EMAIL_UI_MOTION = '1';
process.env.BETTER_EMAIL_UI_CAPTURE_DIR ??= '/tmp/better-email-ui-motion';
await import('./run-ui-smoke.mjs');
