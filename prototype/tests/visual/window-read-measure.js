// Run against window-read-preview.html with agent-browser eval --stdin.
(async () => {
  const fixture = window.windowReadFixture;
  if (!fixture || location.hostname !== "127.0.0.1") throw new Error("Synthetic fixture required");
  const staticViews = [];
  for (const view of ["wizard", "about"]) staticViews.push(await fixture.measure(view));
  const cold = [], warm = [];
  for (const view of ["logbook", "awards", "chaser"]) {
    fixture.render("wizard"); fixture.reset(); cold.push(await fixture.measure(view));
  }
  fixture.render("wizard"); fixture.reset(); await fixture.warm();
  const warmReadCount = fixture.requests.length;
  for (const view of ["logbook", "awards", "chaser"]) warm.push(await fixture.measure(view));
  // Let every already-demanded 200ms frame settle before leaving and returning.
  // This checks transport calls, recorded inside the injected request, not cache calls.
  await fixture.measure("logbook");
  await new Promise(resolve => {
    const settled = () => {
      const lastRead = Math.max(0, ...fixture.requests.filter(row => row.method === "logbook_list").map(row => row.at));
      if (performance.now() - lastRead > 250) resolve(); else requestAnimationFrame(settled);
    };
    settled();
  });
  fixture.render("wizard");
  const settledPageReturn = await fixture.measure("logbook");
  const result = { method: "Actual React components in isolated Chromium; module imports loaded before measurement; synthetic 200ms read transport, native IPC fail-closed. First-data and first observed two-rAF frame are distinct. This does not measure native cold launch, production SQL or provider freshness.",
    viewport: { width: innerWidth, height: innerHeight }, staticViews, cold, warm, warmReadCount, settledPageReturn,
    nativeAttempts: fixture.nativeAttempts, nativeOrHardwareCalls: false };
  if (fixture.nativeAttempts.length || [...staticViews, ...cold, ...warm].some(row => row.horizontalOverflow)) throw new Error(JSON.stringify(result));
  if (settledPageReturn.newReadsAtObservedFrame.length) throw new Error(`Settled page was fetched again: ${JSON.stringify(settledPageReturn)}`);
  window.windowReadMeasurement = result;
  return result;
})();
