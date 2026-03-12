import { useEffect, useState } from "react";

/**
 * Returns a debounced version of `value` that updates only after
 * `delay` milliseconds of inactivity. Useful for search inputs to
 * avoid firing a request on every keystroke.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
