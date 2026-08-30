import { ChevronRight } from 'lucide-react';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type AnimatedDisclosureProps = {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  dataSection?: string;
  defaultOpen?: boolean;
};

/**
 * Shared disclosure for Settings. The region stays mounted so opening,
 * closing and rapid direction changes use the same restrained motion.
 */
export default function AnimatedDisclosure({
  summary,
  children,
  className = '',
  dataSection,
  defaultOpen = false,
}: AnimatedDisclosureProps) {
  const regionId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const regionRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    regionRef.current?.toggleAttribute('inert', !open);
  }, [open]);

  return (
    <div
      className={`settings-animated-disclosure${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
      data-settings-section={dataSection}
    >
      <button
        type="button"
        className="settings-animated-disclosure-trigger"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((current) => !current)}
      >
        {summary}
        <ChevronRight
          className="settings-animated-disclosure-chevron"
          size={15}
          aria-hidden="true"
        />
      </button>
      <div
        ref={regionRef}
        id={regionId}
        className="settings-animated-disclosure-region"
        aria-hidden={!open}
      >
        <div className="settings-animated-disclosure-content">
          {children}
        </div>
      </div>
    </div>
  );
}
