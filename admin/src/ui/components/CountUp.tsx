import { useEffect, useRef } from 'react';
import { animate } from 'framer-motion';
import { fmtNum } from '../lib/format';

export function CountUp({ value, raw = false }: { value: number; raw?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const controls = animate(0, value, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        el.textContent = raw ? Math.round(v).toLocaleString() : fmtNum(Math.round(v));
      },
    });
    return () => controls.stop();
  }, [value, raw]);

  return <span ref={ref}>0</span>;
}
