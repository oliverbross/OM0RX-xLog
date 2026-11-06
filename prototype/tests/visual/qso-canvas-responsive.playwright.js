// Run against the existing inert qso-country-preview.html with a Playwright Page.
// The optional origin permits an isolated loopback Vite server; no native app is used.
async (page, origin = "http://127.0.0.1:1421") => {
  const target = new URL("/tests/visual/qso-country-preview.html", origin);
  if (target.hostname !== "127.0.0.1") throw new Error("Loopback synthetic fixture required");
  const pageErrors = [];
  const onPageError = error => pageErrors.push(String(error));
  page.on("pageerror", onPageError);
  try {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(target.href);
    await page.getByText("Synthetic QSO country identity · no native or device access", { exact: true }).waitFor();
    await page.locator(".qso-canvas-panel").last().waitFor();
    const storageBefore = await page.evaluate(() => localStorage.getItem("xlog.integration.qso-canvas-layout.v1"));
    const rows = [];
    for (const scenario of [
      { name: "wide", viewport: 1600, canvas: 1440, compact: false },
      { name: "sidebar-constrained", viewport: 1008, canvas: 768, compact: true },
      { name: "narrow-viewport", viewport: 800, canvas: 736, compact: true },
      { name: "wide-restored", viewport: 1600, canvas: 1440, compact: false },
    ]) {
      await page.setViewportSize({ width: scenario.viewport, height: 900 });
      await page.locator(".qso-editor").evaluate((element, width) => { element.style.width = width + "px"; }, scenario.canvas);
      await page.waitForFunction(compact => document.querySelector(".qso-canvas")?.classList.contains("is-compact") === compact, scenario.compact);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const geometry = await page.evaluate(() => {
        const rect = element => {
          const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
          return { x, y, width, height, right, bottom };
        };
        const canvas = document.querySelector(".qso-canvas");
        return {
          viewport: innerWidth, canvas: rect(canvas),
          panels: [...canvas.querySelectorAll(".qso-canvas-panel")].map(element => ({
            label: element.getAttribute("aria-label"), ...rect(element),
          })),
          arrangeDisabled: document.querySelector(".qso-canvas-toolbar button").disabled,
        };
      });
      const failures = [];
      if (geometry.viewport !== scenario.viewport || Math.abs(geometry.canvas.width - scenario.canvas) > 1)
        failures.push("Fixture viewport or canvas width differs from the requested case");
      if (geometry.panels.length !== 5) failures.push("Expected all five editor panels");
      if (geometry.arrangeDisabled !== scenario.compact) failures.push("Arrangement availability disagrees with usable canvas width");
      for (const [index, panel] of geometry.panels.entries()) {
        if (panel.width <= 0 || panel.height <= 0) failures.push(panel.label + " has no usable area");
        if (panel.x < geometry.canvas.x - 1 || panel.right > geometry.canvas.right + 1 ||
            panel.y < geometry.canvas.y - 1 || panel.bottom > geometry.canvas.bottom + 1)
          failures.push(panel.label + " lies outside the canvas");
        for (const other of geometry.panels.slice(index + 1)) {
          const overlapWidth = Math.min(panel.right, other.right) - Math.max(panel.x, other.x);
          const overlapHeight = Math.min(panel.bottom, other.bottom) - Math.max(panel.y, other.y);
          if (overlapWidth > 1 && overlapHeight > 1) failures.push(panel.label + " overlaps " + other.label);
        }
        if (scenario.compact) {
          if (Math.abs(panel.width - geometry.canvas.width) > 1) failures.push(panel.label + " does not fill the compact row");
          if (index > 0 && panel.y < geometry.panels[index - 1].bottom + 1)
            failures.push(panel.label + " is not below the preceding panel");
        }
      }
      if (!scenario.compact) {
        const active = geometry.panels.find(panel => panel.label === "Active contact panel");
        const intelligence = geometry.panels.find(panel => panel.label === "Callsign intelligence panel");
        if (!active || !intelligence || intelligence.x < active.right + 1)
          failures.push("Wide layout lost its side-by-side panels");
      }
      rows.push({ ...scenario, geometry, failures });
    }
    const relativeRects = row => row.geometry.panels.map(panel => ({
      label: panel.label, x: panel.x - row.geometry.canvas.x, y: panel.y - row.geometry.canvas.y,
      width: panel.width, height: panel.height,
    }));
    const failures = rows.flatMap(row => row.failures.map(failure => row.name + ": " + failure));
    if (JSON.stringify(relativeRects(rows[0])) !== JSON.stringify(relativeRects(rows[3])))
      failures.push("Returning to a wide canvas changed the panel geometry");
    if (await page.evaluate(() => localStorage.getItem("xlog.integration.qso-canvas-layout.v1")) !== storageBefore)
      failures.push("Responsive rendering rewrote the stored layout");
    failures.push(...pageErrors.map(error => "Browser error: " + error));
    const report = { passed: failures.length === 0, rows, failures };
    if (!report.passed) throw Object.assign(new Error("QSO canvas responsive geometry failed"), { report });
    return report;
  } finally {
    page.off("pageerror", onPageError);
  }
};
