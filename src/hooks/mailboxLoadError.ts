/** The list owns its loading error and retry affordance. Other failures (for
 * example a missing account during metadata bootstrap) still reach the shell. */
export class MailboxLoadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'MailboxLoadError';
  }
}
