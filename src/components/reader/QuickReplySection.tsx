import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Maximize2, Reply, Send } from 'lucide-react';
import type { Message } from '../../app/types';

type ComposeMode = 'reply' | 'replyAll' | 'forward';

export type QuickReplyHandle = { focus: () => void };

type QuickReplySectionProps = {
  selected: Message;
  quickReplyBody: string;
  onQuickReplyChange: (value: string) => void;
  onComposeFromMessage: (message: Message, mode: ComposeMode, prefillBody?: string) => void;
  onSendQuickReply: (message: Message) => void;
  submissionPending?: boolean;
  continuingInComposer?: boolean;
  saveError?: string | null;
  onRetrySave?: () => void;
};

const QuickReplySection = forwardRef<QuickReplyHandle, QuickReplySectionProps>(function QuickReplySection({
  selected,
  quickReplyBody,
  onQuickReplyChange,
  onComposeFromMessage,
  onSendQuickReply,
  submissionPending = false,
  continuingInComposer = false,
  saveError = null,
  onRetrySave,
}, ref) {
  const sectionRef = useRef<HTMLElement>(null);
  const replyInputRef = useRef<HTMLTextAreaElement>(null);
  const pendingFocusKey = useRef<string | null>(null);
  const pendingReveal = useRef<{ key: string; height: number } | null>(null);
  const messageKey = `${selected.account_id}:${selected.id}`;
  const [expandedMessageKey, setExpandedMessageKey] = useState<string | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(() => (
    window.matchMedia?.('(max-width: 720px)').matches ?? window.innerWidth <= 720
  ));
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 720px)');
    if (!media) return undefined;
    const update = () => setIsMobileViewport(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const expanded = quickReplyBody.length > 0 || submissionPending
    || Boolean(saveError) || expandedMessageKey === messageKey;
  const errorId = useId();
  const editorId = useId();

  function focusEditor() {
    const editor = replyInputRef.current;
    if (!editor) return;
    editor.focus({ preventScroll: true });
    const section = sectionRef.current;
    const scrollPort = section?.closest<HTMLElement>('.reader-panel');
    const scrollStyle = scrollPort ? getComputedStyle(scrollPort) : null;
    const usableHeight = (scrollPort?.clientHeight ?? window.innerHeight)
      - (Number.parseFloat(scrollStyle?.scrollPaddingTop ?? '') || 0)
      - (Number.parseFloat(scrollStyle?.scrollPaddingBottom ?? '') || 0);
    // On a phone, reveal Send together with the input when the whole reply
    // fits. Large error/draft surfaces still prioritize the editing caret.
    const target = isMobileViewport && section && section.getBoundingClientRect().height <= usableHeight
      ? section : editor;
    target.scrollIntoView?.({
      block: 'nearest',
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }

  function revealEditor() {
    if (continuingInComposer) {
      onComposeFromMessage(selected, 'reply');
      return;
    }
    if (isMobileViewport && !expanded) {
      pendingReveal.current = { key: messageKey, height: sectionRef.current?.getBoundingClientRect().height ?? 0 };
    }
    setExpandedMessageKey(messageKey);
    if (replyInputRef.current) focusEditor();
    else pendingFocusKey.current = messageKey;
  }

  useImperativeHandle(ref, () => ({ focus: revealEditor }));
  useLayoutEffect(() => {
    const reveal = pendingReveal.current;
    pendingReveal.current = null;
    const section = sectionRef.current;
    if (!expanded || !isMobileViewport || reveal?.key !== messageKey || !section) return undefined;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (preference?.matches || !section.animate || reveal.height <= 0) return undefined;
    const hiddenHeight = Math.max(0, section.getBoundingClientRect().height - reveal.height);
    if (hiddenHeight < 1) return undefined;
    const tokens = getComputedStyle(section);
    const durationToken = tokens.getPropertyValue('--ui-motion-normal').trim();
    const durationValue = Number.parseFloat(durationToken);
    const duration = Number.isFinite(durationValue)
      ? Math.max(0, durationValue * (durationToken.endsWith('ms') ? 1 : 1000)) : 180;
    if (!duration) return undefined;
    // Reserve the final layout once, then reveal only this small editing
    // surface. Neither the long message nor its text scales/reflows per frame.
    // Focus/input are available immediately while the presentation settles.
    section.setAttribute('data-reply-revealing', '');
    const animation = section.animate([
      { clipPath: `inset(0px 0px ${hiddenHeight}px 0px)` },
      { clipPath: 'inset(0px 0px 0px 0px)' },
    ], { duration, easing: tokens.getPropertyValue('--ui-ease-control').trim() || 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' });
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      preference?.removeEventListener?.('change', preferenceChanged);
      animation.onfinish = null;
      animation.cancel();
      section.removeAttribute('data-reply-revealing');
    };
    const preferenceChanged = (event: MediaQueryListEvent) => { if (event.matches) finish(); };
    const timer = window.setTimeout(finish, duration + 50);
    preference?.addEventListener?.('change', preferenceChanged);
    animation.onfinish = finish;
    return finish;
  }, [expanded, isMobileViewport, messageKey]);

  useLayoutEffect(() => {
    if (pendingFocusKey.current === messageKey && expanded) {
      pendingFocusKey.current = null;
      focusEditor();
    }
  });

  return (
    <section
      ref={sectionRef}
      className={`quick-reply${expanded && !continuingInComposer ? '' : ' is-collapsed'}`}
      aria-label="快速回复"
      aria-busy={submissionPending}
    >
      {continuingInComposer ? (
        <button className="quick-reply-entry" type="button" onClick={revealEditor}>
          <Maximize2 size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>继续在写信窗口编辑</span>
        </button>
      ) : !expanded ? (
        <button
          className="quick-reply-entry"
          type="button"
          aria-label="开始快速回复"
          aria-expanded={false}
          aria-controls={editorId}
          onClick={revealEditor}
        >
          <Reply size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>回复 {selected.sender_name || selected.sender_email}…</span>
        </button>
      ) : <>
      <header>
        <div>
          <Reply size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>回复 <strong title={selected.sender_email}>{selected.sender_name || selected.sender_email}</strong></span>
        </div>
      </header>
      <textarea
        id={editorId}
        ref={replyInputRef}
        aria-label="输入回复"
        aria-describedby={saveError ? errorId : undefined}
        readOnly={submissionPending}
        value={quickReplyBody}
        onFocus={() => setExpandedMessageKey(messageKey)}
        onChange={(event) => {
          setExpandedMessageKey(messageKey);
          onQuickReplyChange(event.target.value);
        }}
        placeholder="输入回复…"
      />
      <footer>
        <span role="status">{submissionPending ? '正在提交回复…' : ''}</span>
        <div>
          <button
            type="button"
            disabled={submissionPending}
            onClick={() => onComposeFromMessage(selected, 'reply', quickReplyBody)}
          >
            <Maximize2 size={16} strokeWidth={1.75} aria-hidden="true" />
            展开回复
          </button>
          <button
            className="quick-reply-send"
            type="button"
            onClick={() => {
              // Sending clears the body on success and disables this button.
              // Keep the editing surface as the stable focus destination for
              // both success and retry flows.
              replyInputRef.current?.focus({ preventScroll: true });
              onSendQuickReply(selected);
            }}
            disabled={submissionPending || !quickReplyBody.trim()}
          >
            <Send size={16} strokeWidth={1.75} aria-hidden="true" />
            发送回复
          </button>
        </div>
      </footer>
      </>}
      {saveError && <div className="quick-reply-error" role="alert" id={errorId}>
        <span>{saveError}</span>
        {onRetrySave && <button type="button" onClick={onRetrySave}>重试保存</button>}
      </div>}
    </section>
  );
});

export default QuickReplySection;
