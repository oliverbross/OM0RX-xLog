(() => {
  if (!location.pathname.endsWith("/tests/visual/monitor-preview.html")) throw new Error("Synthetic monitor fixture required");
  if (!document.querySelector('[aria-label="Detached Station Monitor"]')) throw new Error("Actual monitor surface missing");
  if (document.documentElement.scrollWidth > innerWidth + 1) throw new Error("Horizontal page overflow");
  for (const selector of [".monitor-radio", ".monitor-rotor", ".monitor-actions", ".monitor-target"]) {
    for (const element of document.querySelectorAll(selector)) {
      const rect = element.getBoundingClientRect();
      if (rect.left < -1 || rect.right > innerWidth + 1) throw new Error(`Horizontal overflow: ${selector}`);
    }
  }
  const stop = [...document.querySelectorAll(".monitor-rotor button")].find(button => button.textContent === "Stop");
  const stopRect = stop?.getBoundingClientRect();
  if (innerWidth >= 641 && (!stopRect || stopRect.top < 0 || stopRect.bottom > innerHeight)) throw new Error("Desktop Stop is outside the viewport");
  return { viewport: [innerWidth, innerHeight], documentWidth: document.documentElement.scrollWidth,
    stopBounds: stopRect ? [stopRect.top, stopRect.bottom] : null,
    columns: getComputedStyle(document.querySelector(".integrated-monitor")).gridTemplateColumns,
    buttons: [...document.querySelectorAll("button")].map(button => ({ name: button.textContent, disabled: button.disabled })),
    synthetic: document.body.textContent.includes("memory-only observations"),
    radioStale: document.body.textContent.includes("Only selection-fenced Cancel remains available") };
})();
