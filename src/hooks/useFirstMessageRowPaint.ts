import { useLayoutEffect, useRef } from 'react';
import { reportStartupMilestone } from '../startupTelemetry';

export default function useFirstMessageRowPaint(messageCount: number) {
  const firstMessageRowPaintedRef = useRef(false);

  useLayoutEffect(() => {
    if (messageCount === 0 || firstMessageRowPaintedRef.current) return undefined;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (firstMessageRowPaintedRef.current) return;
        firstMessageRowPaintedRef.current = true;
        void reportStartupMilestone('first_message_row_painted');
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [messageCount]);
}
