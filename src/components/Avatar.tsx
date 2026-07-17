import React from 'react';

type AvatarProps = {
  email: string;
  name: string;
  src?: string;
  className?: string;
  fallbackInitial: string;
};

export default function Avatar({ email, name, src, className, fallbackInitial }: AvatarProps) {
  const [candidates, setCandidates] = React.useState<string[]>([]);
  const [candidateIndex, setCandidateIndex] = React.useState(0);
  const altText = name.trim() || email.trim() || fallbackInitial;

  React.useEffect(() => {
    const explicitSrc = src?.trim();
    if (explicitSrc) {
      setCandidates([explicitSrc]);
      setCandidateIndex(0);
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setCandidates([]);
      setCandidateIndex(0);
      return;
    }

    const domain = trimmedEmail.split('@')[1]?.trim();
    const nextCandidates: string[] = [];

    if (domain === 'github.com' && name.trim()) {
      const cleanName = name.split(/\s+/)[0].trim().replace(/[^a-zA-Z0-9\-_]/g, '');
      if (cleanName) {
        nextCandidates.push(`https://unavatar.io/github/${cleanName}`);
      }
    }

    nextCandidates.push(`https://unavatar.io/${encodeURIComponent(trimmedEmail)}?fallback=false`);

    if (domain) {
      nextCandidates.push(`https://unavatar.io/${encodeURIComponent(domain)}?fallback=false`);
      nextCandidates.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`);
    }

    setCandidates(nextCandidates);
    setCandidateIndex(0);
  }, [email, name, src]);

  const currentUrl = candidates[candidateIndex];

  if (currentUrl) {
    return (
      <span className={className}>
        <img
          src={currentUrl}
          alt={altText}
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

  return <span className={className}>{fallbackInitial}</span>;
}
