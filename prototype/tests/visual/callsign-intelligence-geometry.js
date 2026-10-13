// Read-only DOM check; use only with callsign-intelligence-preview.html.
(() => {
  if (!location.pathname.endsWith("/tests/visual/callsign-intelligence-preview.html")) throw new Error("Synthetic intelligence fixture required");
  if (!document.querySelector(".desk-identity strong")) throw new Error("Intelligence component missing");
  if (document.documentElement.scrollWidth > innerWidth + 1) throw new Error("Page overflows horizontally");
  for (const selector of [".desk-identity", ".desk-identity-facts", ".desk-matrices", ".detached-intelligence-actions"]) {
    const element = document.querySelector(selector), rect = element.getBoundingClientRect();
    if (rect.left < -1 || rect.right > innerWidth + 1) throw new Error(`Element outside viewport: ${selector}`);
  }
  if (document.querySelector("input, select, textarea")) throw new Error("Read-only surface contains editing controls");
  const labels = [...document.querySelectorAll("button")].map(button => button.textContent);
  if (labels.some(label => /radio|rotor|Log QSO|Save|Clear/i.test(label))) throw new Error("Unexpected editing or hardware action");
  return { viewport: [innerWidth, innerHeight], documentWidth: document.documentElement.scrollWidth,
    callsign: document.querySelector(".desk-identity strong").textContent, buttons: labels,
    matrixColumns: getComputedStyle(document.querySelector(".desk-matrices")).gridTemplateColumns,
    unavailable: document.body.textContent.includes("Lookup unavailable") };
})();
