import React, { useMemo } from 'react';

export type PlainBodyBlock =
  | { type: 'text'; content: string }
  | { type: 'original'; index: number; meta: string[]; content: string };

const originalMessageMarkerPattern = /^\s*-{2,}\s*(?:原始邮件|original message|forwarded message)\s*-{2,}\s*$/i;
const originalMessageMetaPattern = /^\s*(?:发件人|收件人|抄送|时间|日期|主题|from|to|cc|date|subject)\s*[:：]/i;

function stripQuotePrefix(line: string) {
  return line.replace(/^\s*(?:>\s*)+/, '').trimEnd();
}

function formatPlainTextContent(lines: string[]) {
  return lines
    .map((line) => stripQuotePrefix(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parsePlainBody(body: string): PlainBodyBlock[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: PlainBodyBlock[] = [];
  let textBuffer: string[] = [];
  let originalIndex = 0;

  const flushText = () => {
    const content = textBuffer.join('\n').trim();
    if (content) blocks.push({ type: 'text', content });
    textBuffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!originalMessageMarkerPattern.test(line)) {
      textBuffer.push(line);
      continue;
    }

    flushText();
    originalIndex += 1;

    const meta: string[] = [];
    const content: string[] = [];
    let sawContent = false;

    index += 1;
    for (; index < lines.length; index += 1) {
      const nextLine = lines[index];
      if (originalMessageMarkerPattern.test(nextLine)) {
        index -= 1;
        break;
      }
      if (!sawContent && originalMessageMetaPattern.test(nextLine)) {
        meta.push(nextLine.trim());
        continue;
      }
      if (!sawContent && !nextLine.trim()) {
        continue;
      }
      sawContent = true;
      content.push(nextLine);
    }

    blocks.push({
      type: 'original',
      index: originalIndex,
      meta,
      content: formatPlainTextContent(content),
    });
  }

  flushText();

  if (blocks.length === 0 && body.trim()) {
    return [{ type: 'text', content: body.trim() }];
  }
  return blocks;
}

type EmptyMessageBodyProps = {
  title?: string;
  detail?: string;
  action?: React.ReactNode;
};

export function EmptyMessageBody({
  title = '无正文',
  detail,
  action,
}: EmptyMessageBodyProps) {
  return (
    <div className="body-text reader-empty-body" role="status">
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
      {action}
    </div>
  );
}

type PlainMessageBodyProps = {
  body: string;
};

export default function PlainMessageBody({ body }: PlainMessageBodyProps) {
  const blocks = useMemo(() => parsePlainBody(body), [body]);
  const originalBlockCount = useMemo(
    () => blocks.filter((item) => item.type === 'original').length,
    [blocks],
  );

  if (!body.trim()) {
    return <EmptyMessageBody />;
  }

  return (
    <div className="body-text">
      {blocks.map((block, index) => {
        if (block.type === 'text') {
          return (
            <div className="plain-body-copy" key={`text-${index}`}>
              {block.content}
            </div>
          );
        }

        return (
          <section className="original-message-block" key={`original-${block.index}-${index}`}>
            <header>
              <span>原始邮件</span>
              {originalBlockCount > 1 && (
                <small>{block.index}</small>
              )}
            </header>
            {block.meta.length > 0 && (
              <dl>
                {block.meta.map((item) => {
                  const [label, ...valueParts] = item.split(/[:：]/);
                  return (
                    <React.Fragment key={item}>
                      <dt>{label.trim()}</dt>
                      <dd>{valueParts.join(':').trim()}</dd>
                    </React.Fragment>
                  );
                })}
              </dl>
            )}
            {block.content && <pre>{block.content}</pre>}
          </section>
        );
      })}
    </div>
  );
}
