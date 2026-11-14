import { useId, useState } from 'react';

const MOBILE_EXPAND_THRESHOLD = 56;

export default function ReaderSubject({ subject }: { subject: string }) {
  const titleId = useId();
  const [expandedSubject, setExpandedSubject] = useState<string | null>(null);
  const canExpand = Array.from(subject).length > MOBILE_EXPAND_THRESHOLD;
  const expanded = canExpand && expandedSubject === subject;
  const title = subject || '(无主题)';

  return <>
    <h1
      id={titleId}
      className={`reader-title-block${canExpand && !expanded ? ' reader-title-block--clamped' : ''}`}
    >
      {title}
    </h1>
    {canExpand && (
      <button
        type="button"
        className="reader-subject-toggle"
        aria-expanded={expanded}
        aria-controls={titleId}
        onClick={() => setExpandedSubject(expanded ? null : subject)}
      >
        {expanded ? '收起完整主题' : '展开完整主题'}
      </button>
    )}
  </>;
}
