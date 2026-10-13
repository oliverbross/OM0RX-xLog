// Run via agent-browser eval --stdin on the isolated fixture only.
(async () => {
  if (!location.pathname.endsWith("/qso-country-preview.html")) throw new Error("Synthetic fixture required");
  const selector = document.querySelector("select[aria-label='Synthetic DXCC state']");
  const results = [];
  const width = innerWidth;
    for (const status of ["confirmed", "worked", "new", "pending", "error", "mismatch", "unresolved", "stale"]) {
      selector.value = status;
      selector.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const country = document.querySelector(".qso-country-identity"), utc = document.querySelector(".qso-utc"), rst = document.querySelector(".qso-reports .qso-field>span");
      const a = country.getBoundingClientRect(), b = utc.getBoundingClientRect(), c = rst.getBoundingClientRect();
      const active = document.querySelector(".qso-active"), panel = active.getBoundingClientRect();
      const expected = ["confirmed", "worked", "new"].includes(status) ? status : "neutral";
      const failures = [];
      if (!country.classList.contains(`qso-country-${expected}`)) failures.push("Incorrect history classification");
      if (a.bottom > b.top + 1 || a.left < panel.left || a.right > panel.right) failures.push("Country not contained above UTC");
      if (width > 640 && Math.abs(a.top - c.top) > 1) failures.push("Country and RST labels not aligned");
      if (active.scrollWidth > active.clientWidth + 1) failures.push("Active contact horizontal overflow");
      results.push({ width, status, actual: country.className, labelOffset: a.top - c.top, failures });
    }
  return { passed: results.every(result => !result.failures.length), cases: results.length, failures: results.filter(result => result.failures.length) };
})();
