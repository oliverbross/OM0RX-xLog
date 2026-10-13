import { useLayoutEffect, useState, type RefObject } from "react";

export function logbookCapacity(height: number, header: number, row: number, renderedScale = 1) {
  if (![height, header, row, renderedScale].every(Number.isFinite) || height <= 0 || row <= 0 || renderedScale <= 0) return 100;
  // clientHeight uses layout pixels; bounding rectangles include CSS/UI zoom.
  // Keep both measurements in the same coordinate system at high-DPI scales.
  return Math.max(1, Math.min(100, Math.floor((height - header / renderedScale - 2) / (row / renderedScale))));
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
        const renderedScale = element.offsetHeight > 0 ? element.getBoundingClientRect().height / element.offsetHeight : 1;
        setCapacity(logbookCapacity(element.clientHeight, head.getBoundingClientRect().height, row.getBoundingClientRect().height, renderedScale));
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
