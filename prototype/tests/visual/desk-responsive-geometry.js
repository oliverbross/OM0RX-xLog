// Run with agent-browser eval --stdin on desk-responsive-preview.html only.
(async () => {
  if (!location.pathname.endsWith("/desk-responsive-preview.html")) throw new Error("Synthetic fixture required");
  const root = document.querySelector("main.live");
  const measure = element => {
    const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
    return { x, y, width, height, right, bottom };
  };
  const results = [];
  for (const width of [3840, 2560, 1984, 1920, 1841, 1840.5, 1840, 1824.75, 1824.5, 1824.25, 1824,
    1800, 1760, 1730, 1650, 1500, 1470, 1450, 1421, 1420.5, 1420, 1419.5,
    1280, 1000.5, 1000, 999.5, 907, 906, 900, 760.5, 760, 759.5, 560.5, 560, 559.5, 440, 360]) {
    root.style.width = `${width + 32}px`;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const panels = [...document.querySelectorAll(".desk-panel")];
    const failures = [];
    for (const panel of panels) {
      const box = measure(panel);
      if (panel.scrollWidth > panel.clientWidth + 1) failures.push(`${panel.className}: horizontal overflow`);
      if (panel.scrollHeight > panel.clientHeight + 1) failures.push(`${panel.className}: vertical overflow`);
      for (const field of panel.querySelectorAll("input:not([type=checkbox]), select, button, .rotor-dial, .desk-current")) {
        const item = measure(field);
        if (item.x < box.x - 1 || item.right > box.right + 1 || item.bottom > box.bottom + 1)
          failures.push(`${field.getAttribute("aria-label") || field.className}: outside panel`);
      }
    }
    const active = measure(document.querySelector(".desk-active"));
    const intelligence = measure(document.querySelector(".desk-intelligence"));
    const rotor = document.querySelector(".desk-rotor");
    const stacked = intelligence.y > active.y + 1;
    if (width > 1420 && stacked) failures.push("Usable desk should remain side by side; reflow Active QSO fields first");
    if (width <= 1420 && !stacked) failures.push("Narrow layout should retain the full-width Active QSO");
    if (width > 1840 && active.height > 282)
      failures.push("Unnecessary wrapping has enlarged the top row");
    const primary = document.querySelector(".desk-active-primary");
    const primaryWidth = primary.getBoundingClientRect().width;
    const rstWidths = [...primary.querySelectorAll('input[aria-label="Desk RST S"], input[aria-label="Desk RST R"]')].map(field => measure(field).width);
    if (rstWidths.some(value => value < 44)) failures.push("RST field no longer has a readable minimum width");
    results.push({ width, stacked, activeHeight: active.height,
      primaryWidth, primaryColumns: getComputedStyle(primary).gridTemplateColumns, rstWidths,
      dialWidth: rotor ? measure(rotor.querySelector(".rotor-dial")).width : null, failures });
  }
  root.style.removeProperty("width");
  return { passed: results.every(result => result.failures.length === 0), results };
})();
