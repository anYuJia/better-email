export const providerWriteValidationStorageKey = 'better-email.providerWriteValidationIds.v1';
export const providerWritebackValidationStorageKey = 'better-email.providerWritebackValidation.v1';

export type ProviderWriteValidationStageTone =
  | 'pending'
  | 'active'
  | 'passed'
  | 'warning'
  | 'failed';

export type ProviderWriteValidationStage = {
  id: 'smtp' | 'archive' | 'receipt' | 'attachment' | 'remote';
  title: string;
  tone: ProviderWriteValidationStageTone;
  detail: string;
};

export type ProviderWriteValidationStatus = {
  validationId: string;
  subject: string;
  stages: ProviderWriteValidationStage[];
  passedCoreStages: number;
  coreStageCount: number;
  complete: boolean;
  writebackComplete: boolean;
  sentMessageId: number | null;
  receivedMessageId: number | null;
};

export type ProviderWritebackValidationStepId = 'read' | 'star' | 'archive' | 'restore';
export type ProviderWritebackValidationState =
  | 'pending'
  | 'running'
  | 'passed'
  | 'warning'
  | 'failed';

export type ProviderWritebackValidationResult = {
  state: 'passed' | 'warning' | 'failed';
  detail: string;
  checkedAt: string;
};

export type ProviderWritebackValidationRecord = {
  validationId: string;
  results: Partial<Record<ProviderWritebackValidationStepId, ProviderWritebackValidationResult>>;
};

export type ProviderWritebackValidationStep = {
  id: ProviderWritebackValidationStepId;
  title: string;
  state: ProviderWritebackValidationState;
  detail: string;
  enabled: boolean;
};

export type ProviderWritebackValidationProgress = {
  validationId: string;
  ready: boolean;
  blockedReason: string;
  steps: ProviderWritebackValidationStep[];
  passedSteps: number;
  totalSteps: number;
  complete: boolean;
};
