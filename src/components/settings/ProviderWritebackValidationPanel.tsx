import {
  Archive,
  CheckCircle2,
  Eye,
  LoaderCircle,
  RotateCcw,
  Star,
  Undo2,
} from 'lucide-react';
import type {
  ProviderWritebackValidationProgress,
  ProviderWritebackValidationStepId,
} from '../../app/providerWriteValidation';

type ProviderWritebackValidationPanelProps = {
  progress: ProviderWritebackValidationProgress;
  onRunStep: (step: ProviderWritebackValidationStepId) => void;
  onReset: () => void;
};

const stepIcons = {
  read: Eye,
  star: Star,
  archive: Archive,
  restore: Undo2,
};

function stepStateLabel(state: ProviderWritebackValidationProgress['steps'][number]['state']) {
  if (state === 'passed') return '通过';
  if (state === 'running') return '执行中';
  if (state === 'warning') return '仅本地';
  if (state === 'failed') return '失败';
  return '等待';
}

export default function ProviderWritebackValidationPanel({
  progress,
  onRunStep,
  onReset,
}: ProviderWritebackValidationPanelProps) {
  const hasResults = progress.steps.some((step) =>
    ['passed', 'warning', 'failed'].includes(step.state));

  return (
    <section
      className="writeback-validation-panel"
      data-writeback-complete={progress.complete}
      data-writeback-validation-id={progress.validationId}
    >
      <header>
        <span>
          <strong>远端回写向导</strong>
          <small>只操作当前验证编号的自发自收邮件，按顺序确认 IMAP 状态。</small>
        </span>
        <div>
          <b>{progress.passedSteps}/{progress.totalSteps}</b>
          <button
            className="secondary"
            disabled={!hasResults || progress.steps.some((step) => step.state === 'running')}
            title="清除本机记录，从已读步骤重新验收"
            type="button"
            onClick={onReset}
          >
            <RotateCcw size={13} />
            重置
          </button>
        </div>
      </header>
      {progress.blockedReason && (
        <p className="writeback-validation-blocked">{progress.blockedReason}</p>
      )}
      <div className="writeback-validation-grid">
        {progress.steps.map((step, index) => {
          const StepIcon = stepIcons[step.id];
          return (
            <article
              className={`writeback-validation-step ${step.state}`}
              data-writeback-step={step.id}
              key={step.id}
            >
              <header>
                <span>
                  <i>{index + 1}</i>
                  <StepIcon size={14} />
                  <strong>{step.title}</strong>
                </span>
                <b>{stepStateLabel(step.state)}</b>
              </header>
              <p>{step.detail}</p>
              <button
                data-writeback-step-action={step.id}
                disabled={!step.enabled}
                type="button"
                onClick={() => onRunStep(step.id)}
              >
                {step.state === 'running'
                  ? <LoaderCircle className="spin" size={14} />
                  : step.state === 'passed'
                    ? <CheckCircle2 size={14} />
                    : <StepIcon size={14} />}
                {step.state === 'running'
                  ? '执行中'
                  : step.state === 'passed'
                    ? '已通过'
                    : step.state === 'failed' || step.state === 'warning'
                      ? '重试'
                      : '开始'}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
