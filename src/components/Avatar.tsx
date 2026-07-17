import React from 'react';

type AvatarProps = {
  email: string;
  name: string;
  className?: string;
  fallbackInitial: string;
};

export default function Avatar({ email, name, className, fallbackInitial }: AvatarProps) {
  const [candidates, setCandidates] = React.useState<string[]>([]);
  const [candidateIndex, setCandidateIndex] = React.useState(0);

  React.useEffect(() => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setCandidates([]);
      setCandidateIndex(0);
      return;
    }

    const domain = trimmedEmail.split('@')[1];
    const newCandidates: string[] = [];

    // 1. GitHub specific handling
    if (domain === 'github.com' && name) {
      const cleanName = name.split(/\s+/)[0].trim().replace(/[^a-zA-Z0-9\-_]/g, '');
      if (cleanName) {
        newCandidates.push(`https://unavatar.io/github/${cleanName}`);
      }
    }

    // 2. Computes hash and constructs candidates list
    const setupCandidates = async () => {
      try {
        const msgBuffer = new TextEncoder().encode(trimmedEmail);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        newCandidates.push(`https://www.gravatar.com/avatar/${hashHex}?d=404`);
      } catch (e) {
        // Ignore hash failure
      }

      newCandidates.push(`https://unavatar.io/${trimmedEmail}?fallback=false`);

      if (domain) {
        newCandidates.push(`https://unavatar.io/${domain}?fallback=false`);
        newCandidates.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=64`);
      }

      setCandidates(newCandidates);
      setCandidateIndex(0);
    };

    setupCandidates();
  }, [email, name]);

  const currentUrl = candidates[candidateIndex];

  if (currentUrl) {
    return (
      <span className={className}>
        <img
          src={currentUrl}
          alt={name}
          onError={() => {
            setCandidateIndex((prev) => prev + 1);
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
