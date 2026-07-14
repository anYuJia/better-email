import React from 'react';

export function EmailHeaderSkeleton() {
  return (
    <div className="email-reader-skeleton-header">
      <div className="skeleton-title-row">
        <div className="skeleton-line skeleton-title" />
      </div>
      <div className="skeleton-sender-row">
        <div className="skeleton-avatar" />
        <div className="skeleton-sender-info">
          <div className="skeleton-line skeleton-sender-name" />
          <div className="skeleton-line skeleton-sender-email" />
        </div>
      </div>
    </div>
  );
}

export function EmailBodySkeleton() {
  return (
    <div className="email-reader-skeleton-body">
      <div className="skeleton-line skeleton-body-line width-90" />
      <div className="skeleton-line skeleton-body-line width-100" />
      <div className="skeleton-line skeleton-body-line width-95" />
      <div className="skeleton-line skeleton-body-line width-60" />
      <div className="skeleton-line skeleton-body-line width-80" />
      <div className="skeleton-line skeleton-body-line width-90" />
      <div className="skeleton-line skeleton-body-line width-40" />
    </div>
  );
}

export default function EmailReaderSkeleton() {
  return (
    <div className="email-reader-skeleton-container" aria-busy="true" aria-label="正在加载邮件内容">
      <EmailHeaderSkeleton />
      <EmailBodySkeleton />
    </div>
  );
}
