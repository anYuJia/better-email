import React from 'react';
import { senderInitial } from '../app/messageDetailUtils';

type AvatarProps = {
  email: string;
  name: string;
  src?: string;
  className?: string;
  fallbackInitial?: string;
};

export function isValidAvatarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function Avatar({ email, name, src, className, fallbackInitial }: AvatarProps) {
  const [imageFailed, setImageFailed] = React.useState(false);
  const rawUrl = (src || '').trim();
  const avatarUrl = isValidAvatarUrl(rawUrl) ? rawUrl : '';
  const initial = fallbackInitial || senderInitial(name, email);
  const altText = name.trim() || email.trim() || initial;

  React.useEffect(() => {
    setImageFailed(false);
  }, [avatarUrl]);

  if (avatarUrl && !imageFailed) {
    return (
      <span className={className}>
        <img
          src={avatarUrl}
          alt={altText}
          onError={() => {
            setImageFailed(true);
          }}
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 'inherit',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </span>
    );
  }

  return (
    <span className={`${className} avatar-initial`} aria-label={altText}>
      {initial}
    </span>
  );
}
