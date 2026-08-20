import React from 'react';
import { senderInitial } from '../app/messageDetailUtils';

const minUsableAvatarPixelSize = 32;

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

export function inferredAvatarCandidates(_email: string, _name: string): string[] {
  // Local-first privacy: never turn a sender address into an automatic
  // third-party request. A caller may still provide an explicit, trusted src.
  return [];
}

export default function Avatar({ email, name, src, className, fallbackInitial }: AvatarProps) {
  const rawUrl = (src || '').trim();
  const avatarUrls = React.useMemo(() => {
    if (rawUrl) {
      return isValidAvatarUrl(rawUrl) ? [rawUrl] : [];
    }
    return inferredAvatarCandidates(email, name);
  }, [email, name, rawUrl]);
  const avatarKey = avatarUrls.join('\n');
  const [candidateIndex, setCandidateIndex] = React.useState(0);
  const avatarUrl = avatarUrls[candidateIndex] ?? '';
  const initial = fallbackInitial || senderInitial(name, email);
  const altText = name.trim() || email.trim() || initial;

  React.useEffect(() => {
    setCandidateIndex(0);
  }, [avatarKey]);

  if (avatarUrl) {
    return (
      <span className={className}>
        <img
          src={avatarUrl}
          alt={altText}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (
              image.naturalWidth > 0 &&
              image.naturalHeight > 0 &&
              (image.naturalWidth < minUsableAvatarPixelSize || image.naturalHeight < minUsableAvatarPixelSize)
            ) {
              setCandidateIndex((current) => current + 1);
            }
          }}
          onError={() => {
            setCandidateIndex((current) => current + 1);
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
