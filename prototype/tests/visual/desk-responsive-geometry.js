// Run with agent-browser eval --stdin on desk-responsive-preview.html only.
(async () => {
  if (!location.pathname.endsWith("/desk-responsive-preview.html")) throw new Error("Synthetic fixture required");
  const root = document.querySelector("main.live");
  const measure = element => {
    const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
    return { x, y, width, height, right, bottom };
  };
  const results = [];
  for (const width of [3840, 1920, 1841, 1840.5, 1840, 1800, 1500, 1470, 1450, 1421, 1420.5, 1420, 1000, 907, 906, 900, 560, 360]) {
    root.style.width = `${width + 32}px`;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const panels = [...document.querySelectorAll(".desk-panel")];
    const failures = [];
    for (const panel of panels) {
      const box = measure(panel);
      if (panel.scrollWidth > panel.clientWidth + 1) failures.push(`${panel.className}: horizontal overflow`);
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
    if (rotor && width <= 1840 && width > 1420 && !stacked) failures.push("Expected full-width Active QSO");
    if (width > 1840 && stacked) failures.push("Wide layout should remain side by side");
    if (!rotor && width > 1420 && stacked) failures.push("Equipment-free layout should remain side by side");
    if (width > 1420 && (!rotor || width > 1840) && active.height > 300)
      failures.push("Unnecessary wrapping has enlarged the top row");
    results.push({ width, stacked, activeHeight: active.height,
      dialWidth: rotor ? measure(rotor.querySelector(".rotor-dial")).width : null, failures });
  }
  root.style.removeProperty("width");
  return { passed: results.every(result => result.failures.length === 0), results };
})();
