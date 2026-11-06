// Actual Map component and production CSS, with a test-only constructor failure.
// No WebGL/browser flags, native bridge, station transport or production profile.
async (page, origin = "http://127.0.0.1:1421") => {
  const target = new URL("/tests/visual/map-error-preview.html", origin);
  if (target.hostname !== "127.0.0.1") throw new Error("Loopback synthetic fixture required");
  const message = "WebGL2 is unavailable. The map cannot be rendered in this synthetic fixture. " +
    "Diagnostic: https://example.invalid/maps/" + "WebGL2Diagnostic".repeat(12);
  const mockUrl = url => url.origin === target.origin && url.pathname.endsWith("/maplibre-gl.js");
  let mockedModules = 0;
  const mockRenderer = route => {
    mockedModules++;
    return route.fulfill({ contentType: "text/javascript", body:
      "export function setWorkerUrl() {} export class Map { constructor() {" +
      "document.documentElement.dataset.syntheticMapFailure = 'true'; throw new Error(" +
      JSON.stringify(message) + "); } }" });
  };
  const pageErrors = [];
  const onError = error => pageErrors.push(String(error));
  page.on("pageerror", onError);
  await page.addInitScript(() => { window.__xlogMapErrorFixture = true; });
  await page.route(mockUrl, mockRenderer);
  const rows = [];
  try {
    for (const scenario of [
      { name: "world-map", viewport: 1024, width: 798, height: 520, compact: false },
      { name: "wrapped-toolbar", viewport: 800, width: 480, height: 520, compact: false },
      { name: "compact-desk", viewport: 640, width: 320, height: 180, compact: true },
      { name: "world-map-restored", viewport: 1024, width: 798, height: 520, compact: false },
    ]) {
      await page.setViewportSize({ width: scenario.viewport, height: 800 });
      target.search = scenario.compact ? "?compact=1" : "";
      await page.goto(target.href);
      await page.getByText("Synthetic map error · no native or device access", { exact: true }).waitFor();
      await page.getByRole("alert").filter({ hasText: message }).waitFor();
      await page.locator(".map-error-fixture-pane").evaluate((element, size) => {
        element.style.width = size.width + "px"; element.style.height = size.height + "px";
      }, scenario);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const measure = () => page.evaluate(() => {
        const pane = document.querySelector(".map-error-fixture-pane");
        const wrap = pane.querySelector(".map-wrap"), alert = wrap.querySelector(".map-error");
        const rect = element => {
          const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
          return { x, y, width, height, right, bottom };
        };
        const overlays = [".map-toolbar", ".map-rbn-toggle", ".map-rbn-panel", ".map-error", ".map-legend"]
          .flatMap(selector => [...wrap.querySelectorAll(selector)].map(element => ({ selector, ...rect(element) })));
        const style = getComputedStyle(alert), wrapStyle = getComputedStyle(wrap);
        const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
        const luminance = value => {
          const channels = rgb(value).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
          return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
        };
        const light = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => a - b);
        const textRange = document.createRange(); textRange.selectNodeContents(alert);
        const textRects = [...textRange.getClientRects()].filter(value => value.width > 0 && value.height > 0);
        const outer = rect(wrap), alertRect = rect(alert), beforeScroll = wrap.scrollTop;
        const hitTests = textRects.map((value, index) => {
          // Bring each text line into the real scroll viewport, then test paint order.
          const current = textRange.getClientRects()[index];
          wrap.scrollTop += current.top + current.height / 2 - (outer.y + outer.height / 2);
          const line = textRange.getClientRects()[index], x = line.left + line.width / 2, y = line.top + line.height / 2;
          const hit = document.elementFromPoint(x, y);
          return { line: index + 1, visible: x >= outer.x && x <= outer.right && y >= outer.y && y <= outer.bottom,
            alertHit: !!hit && alert.contains(hit), hitTag: hit?.tagName, hitClass: hit?.className };
        });
        wrap.scrollTop = beforeScroll;
        const band = wrap.querySelector("select[aria-label='Heard me band scope']");
        let bandHit = null;
        if (band) {
          band.scrollIntoView({ block: "nearest" });
          const b = rect(band); bandHit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) === band;
          wrap.scrollTop = beforeScroll;
        }
        return { pane: rect(pane), wrap: outer, alert: alertRect, overlays,
          textLines: textRects.length,
          textContained: textRects.every(line => line.left >= alertRect.x - 1 && line.right <= alertRect.right + 1 &&
            line.top >= alertRect.y - 1 && line.bottom <= alertRect.bottom + 1),
          contrast: (light[1] + .05) / (light[0] + .05), hitTests, bandHit,
          scrollWidth: wrap.scrollWidth, clientWidth: wrap.clientWidth,
          scrollHeight: wrap.scrollHeight, clientHeight: wrap.clientHeight, overflowY: wrapStyle.overflowY,
          syntheticConstructorFailure: document.documentElement.dataset.syntheticMapFailure === "true" };
      });
      const closed = await measure();
      await page.getByRole("button", { name: "Heard me", exact: true }).click();
      await page.getByRole("complementary", { name: "Heard me reception reports" }).waitFor();
      await page.getByText("No reports in this scope.", { exact: true }).waitFor();
      const band = page.getByLabel("Heard me band scope");
      await band.selectOption("all");
      const open = await measure(), selectedBand = await band.inputValue();
      let scroll = null;
      if (scenario.compact) {
        await page.locator(".map-wrap").evaluate(element => { element.scrollTop = 0; });
        const box = await page.locator(".map-wrap").boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 600);
        try { await page.waitForFunction(() => document.querySelector(".map-wrap").scrollTop > 0, null, { timeout: 1000 }); } catch {}
        scroll = await page.locator(".map-wrap").evaluate(element => ({
          top: element.scrollTop, maximum: element.scrollHeight - element.clientHeight,
          overflowY: getComputedStyle(element).overflowY,
        }));
      }
      await page.getByRole("button", { name: "Heard me", exact: true }).click();
      const panelClosed = await page.getByRole("complementary", { name: "Heard me reception reports" }).count() === 0;
      const failures = [];
      for (const [state, geometry] of Object.entries({ closed, open })) {
        if (!geometry.syntheticConstructorFailure) failures.push(state + ": constructor failure was not injected");
        if (Math.abs(geometry.wrap.width - scenario.width) > 1 || Math.abs(geometry.wrap.height - scenario.height) > 1)
          failures.push(state + ": map is not contained in the requested pane");
        if (geometry.scrollWidth > geometry.clientWidth + 1 || !geometry.textContained)
          failures.push(state + ": diagnostic text overflows horizontally or leaves its alert");
        if (geometry.textLines < 2) failures.push(state + ": long diagnostic did not wrap");
        if (geometry.contrast < 4.5) failures.push(state + ": diagnostic contrast is below 4.5:1");
        if (geometry.hitTests.some(line => !line.visible || !line.alertHit))
          failures.push(state + ": diagnostic text is clipped or covered by another overlay");
        for (const [index, a] of geometry.overlays.entries()) {
          if (a.x < geometry.wrap.x - 1 || a.right > geometry.wrap.right + 1)
            failures.push(state + ": " + a.selector + " exceeds pane width");
          for (const b of geometry.overlays.slice(index + 1)) {
            if (Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
                Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1)
              failures.push(state + ": " + a.selector + " overlaps " + b.selector);
          }
        }
      }
      if (selectedBand !== "all" || !open.bandHit || !panelClosed)
        failures.push("Heard-me controls are obscured or failed to open, change scope and close");
      if (scenario.compact && (!scroll || scroll.maximum <= 0 || scroll.top <= 0 || !["auto", "scroll"].includes(scroll.overflowY)))
        failures.push("Compact pane does not expose its overflow through user scrolling");
      rows.push({ ...scenario, closed, open, selectedBand, panelClosed, scroll, failures });
    }
    const failures = rows.flatMap(row => row.failures.map(failure => row.name + ": " + failure));
    if (mockedModules !== rows.length) failures.push("Expected one isolated mocked renderer module per page");
    failures.push(...pageErrors.map(error => "Browser error: " + error));
    const report = { passed: failures.length === 0, mockedModules, rows, failures };
    if (!report.passed) throw Object.assign(new Error("Map error geometry failed"), { report });
    return report;
  } finally {
    page.off("pageerror", onError);
    await page.unroute(mockUrl, mockRenderer);
  }
};
