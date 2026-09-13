import { useEffect, useState } from "react";

/** `value`, except `true` only takes effect after it has held for `delayMs`. `false` is immediate. */
export function useDelayedTrue(value: boolean, delayMs: number): boolean {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (!value) {
      setDelayed(false);
      return;
    }
    const timer = setTimeout(() => setDelayed(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);
  return value && delayed;
}
