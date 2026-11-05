export const mobileSelectionHistoryKey = 'betterEmailInboxSelection';

/** Ephemeral selection belongs above a destination, never inside its state. */
export function withoutMobileSelection(state: Record<string, unknown> | null) {
  const { [mobileSelectionHistoryKey]: _selection, ...destination } = state ?? {};
  return destination;
}
