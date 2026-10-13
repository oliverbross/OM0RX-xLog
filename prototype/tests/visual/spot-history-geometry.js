// Run with agent-browser eval --stdin only against the isolated synthetic fixture.
(() => {
  if (!location.pathname.endsWith("/spot-history-preview.html")) throw new Error("Synthetic fixture required");
  const main = document.querySelector('main[aria-label="Detached Spot History"]');
  const table = document.querySelector('[aria-label="History reports table"]');
  const failures = [];
  const rect = element => {
    const { x, y, right, bottom, width, height } = element.getBoundingClientRect();
    return { x, y, right, bottom, width, height };
  };
  if (!main || !table) throw new Error("Actual child has not loaded");
  if (document.documentElement.scrollWidth > innerWidth + 1) failures.push("Document horizontal overflow");
  const box = rect(main);
  const shell = main.parentElement;
  const controls = [...main.querySelectorAll("input,select,button")].filter(element => element.getClientRects().length);
  for (const control of controls) {
    const item = rect(control);
    if (item.x < box.x - 1 || item.right > box.right + 1)
      failures.push(`${control.getAttribute("aria-label") || control.textContent}: outside horizontal surface`);
    if (item.bottom > innerHeight + 1) failures.push("Control below synthetic viewport");
    if (item.height < 20) failures.push("Control has unreadable height");
  }
  const trace = window.spotHistoryVisualFixture.snapshot();
  if (trace.forbidden.length) failures.push(`Forbidden access: ${trace.forbidden.join(", ")}`);
  const allowed = new Set(["spot_history_status", "spot_history_query", "spot_history_stats", "spot_history_detail"]);
  if (trace.requests.some(method => !allowed.has(method))) failures.push("Non-archive request");
  return { passed: failures.length === 0, viewport: { width: innerWidth, height: innerHeight },
    shell: { ...rect(shell), heightStyle: getComputedStyle(shell).height },
    main: box, table: rect(table), tableScroll: { client: table.clientWidth, scroll: table.scrollWidth },
    controls: controls.length, trace, failures };
})();
