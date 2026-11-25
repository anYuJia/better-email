import { useId, useLayoutEffect, useRef, useState } from 'react';

export default function ReaderSubject({ subject }: { subject: string }) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [canExpand, setCanExpand] = useState(false);
  const [expandedSubject, setExpandedSubject] = useState<string | null>(null);
  const expanded = canExpand && expandedSubject === subject;

  useLayoutEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(title).lineHeight);
      const overflowing = title.scrollHeight > 3 * lineHeight + 1;
      setCanExpand(overflowing);
      if (!overflowing) setExpandedSubject(null);
    };
    if (typeof ResizeObserver === 'undefined') {
      measure();
      return;
    }
    // The title is already clamped by CSS. Read its first layout from the
    // observer so switching messages does not force a layout during commit.
    const observer = new ResizeObserver(measure);
    observer.observe(title);
    return () => observer.disconnect();
  }, [subject]);

  return <>
    <h1
      id={titleId}
      ref={titleRef}
      className={expanded ? 'reader-title-block' : 'reader-title-block reader-title-block--clamped'}
    >
      {subject || '(无主题)'}
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
