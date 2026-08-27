export type ComposerBootOpenDecision = {
  shouldOpen: boolean;
  restoreWhenMissing: boolean;
};

export function decideComposerBootOpen(
  hasPendingRequest: boolean,
  isPrewarmedWindow: boolean,
  openRequestedBeforeBoot: boolean,
): ComposerBootOpenDecision {
  return {
    shouldOpen: hasPendingRequest || !isPrewarmedWindow || openRequestedBeforeBoot,
    restoreWhenMissing: !hasPendingRequest,
  };
}
