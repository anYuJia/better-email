import React from 'react';
import { senderInitial } from '../app/messageDetailUtils';

const minUsableAvatarPixelSize = 32;
const serviceAvatarDomains: Record<string, string> = {
  'github.com': 'github.com',
  'facebook.com': 'facebook.com',
  'facebookmail.com': 'facebook.com',
  'instagram.com': 'instagram.com',
  'linkedin.com': 'linkedin.com',
  'twitter.com': 'twitter.com',
  'x.com': 'x.com',
  'youtube.com': 'youtube.com',
  'google.com': 'google.com',
  'openai.com': 'openai.com',
  'anthropic.com': 'anthropic.com',
  'figma.com': 'figma.com',
  'notion.so': 'notion.so',
  'slack.com': 'slack.com',
  'stripe.com': 'stripe.com',
};

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

export function inferredAvatarCandidates(email: string, name: string): string[] {
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail) return [];

  const domain = trimmedEmail.split('@')[1]?.trim();
  const serviceDomain = domain ? serviceAvatarDomains[domain] : '';
  if (!serviceDomain) return [];

  const candidates: string[] = [];

  if (domain === 'github.com' && name.trim()) {
    const cleanName = name.split(/\s+/)[0].trim().replace(/[^a-zA-Z0-9\-_]/g, '');
    if (cleanName) {
      candidates.push(`https://unavatar.io/github/${encodeURIComponent(cleanName)}`);
    }
  }

  candidates.push(`https://unavatar.io/${encodeURIComponent(serviceDomain)}?fallback=false`);

  return candidates;
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
