export type ComposerBootOpenDecision = {
  shouldOpen: boolean;
  restoreWhenMissing: boolean;
};

export type ComposerRevealState = {
  booted: boolean;
  closeListenerReady: boolean;
  composerOpen: boolean;
  hasLoadError: boolean;
  openRequested: boolean;
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

export function shouldRevealComposerWindow({
  booted,
  closeListenerReady,
  composerOpen,
  hasLoadError,
  openRequested,
}: ComposerRevealState): boolean {
  if (!closeListenerReady) return false;
  if (hasLoadError) return openRequested;
  return booted && composerOpen;
}
