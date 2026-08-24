/**
 * Compatibility entry point for callers and older tests. The application now
 * owns an integrated AppTitlebar; keeping this alias avoids a second chrome
 * implementation from returning in a future refactor.
 */
export { default, detectDesktopPlatform } from './AppTitlebar';
export type { DesktopPlatform } from './AppTitlebar';
