import React from 'react';

type AvatarProps = {
  email: string;
  name: string;
  src?: string;
  className?: string;
  fallbackInitial: string;
};

export default function Avatar({ email, name, src, className, fallbackInitial }: AvatarProps) {
  const [imageFailed, setImageFailed] = React.useState(false);
  const avatarSrc = src?.trim() ?? '';
  const altText = name.trim() || email.trim() || fallbackInitial;

  React.useEffect(() => {
    setImageFailed(false);
  }, [avatarSrc]);

  if (avatarSrc && !imageFailed) {
    return (
      <span className={className}>
        <img
          src={avatarSrc}
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

  return <span className={className}>{fallbackInitial}</span>;
}
