import { useLayoutEffect, useState, type RefObject } from "react";

export function logbookCapacity(height: number, header: number, row: number) {
  if (![height, header, row].every(Number.isFinite) || height <= 0 || row <= 0) return 100;
  return Math.max(1, Math.min(100, Math.floor((height - header - 2) / row)));
}

/** Measure the actual rendered type size, including UI zoom. Only a settled
 * capacity change fetches another page; pointer-move frames do not query SQLite. */
export function useLogbookCapacity(ref: RefObject<HTMLDivElement | null>, rowCount: number) {
  const [capacity, setCapacity] = useState(100);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const head = element.querySelector("thead"), row = element.querySelector("tbody tr");
        if (!head || !row) return;
        setCapacity(logbookCapacity(element.clientHeight, head.getBoundingClientRect().height, row.getBoundingClientRect().height));
      }, 120);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const target of element.querySelectorAll("thead, tbody tr:first-child")) observer.observe(target);
    measure();
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [ref, rowCount]);
  return capacity;
}
