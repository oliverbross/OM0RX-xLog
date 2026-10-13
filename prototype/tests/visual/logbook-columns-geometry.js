// Run against logbook-preview.html only: agent-browser eval --stdin < this-file.
// Presentation/DOM inspection; no IPC, contact mutations or station operations.
(async () => {
  const wrap = document.querySelector(".live-logbook-table-wrap");
  const table = document.querySelector(".live-logbook-table");
  if (!wrap || !table || !location.pathname.endsWith("/tests/visual/logbook-preview.html")) throw new Error("Synthetic Logbook fixture required");
  // Resize/page capacity settles asynchronously. Do not capture an old narrow
  // page count in a newly enlarged viewport and mistake the blank area for layout.
  for (let frame = 0; frame < 120; frame++) {
    const row = table.querySelector("tbody tr:nth-child(2)") ?? table.querySelector("tbody tr");
    const scale = wrap.offsetHeight > 0 ? wrap.getBoundingClientRect().height / wrap.offsetHeight : 1;
    const capacity = Math.max(1, Math.min(100, Math.floor((wrap.clientHeight - table.tHead.getBoundingClientRect().height / scale - 2) / (row.getBoundingClientRect().height / scale))));
    if (table.tBodies[0].rows.length === capacity) break;
    if (frame === 119) throw new Error("Synthetic page capacity did not settle");
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  const headers = [...table.querySelectorAll("th")];
  const expected = headers.map(th => th.querySelector("span").textContent);
  const first = table.querySelector("tbody tr");
  const cells = [...first.cells].filter(cell => getComputedStyle(cell).display !== "none");
  if (headers.length !== cells.length) throw new Error("Header/body column mismatch");
  if (!expected.includes("Callsign")) throw new Error("Callsign missing");
  if (document.documentElement.scrollWidth > innerWidth + 1) throw new Error("Document overflows horizontally");
  const controls = document.querySelector(".live-logbook-columns");
  if (controls) {
    const done = [...controls.querySelectorAll("button")].find(button => button.textContent === "Done").getBoundingClientRect();
    const panel = controls.getBoundingClientRect();
    if (done.bottom > panel.bottom + 1 || done.top < panel.top - 1) throw new Error("Column actions are outside the visible editor");
  }
  const before = wrap.scrollLeft;
  wrap.scrollLeft = wrap.scrollWidth;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const call = first.querySelector(".live-logbook-call").getBoundingClientRect();
  const bounds = wrap.getBoundingClientRect();
  if (call.left < bounds.left - 1 || call.right > bounds.right + 1) throw new Error("Callsign not findable after horizontal scrolling");
  const result = { viewport: [innerWidth, innerHeight], columns: expected, documentWidth: document.documentElement.scrollWidth,
    tableWidth: table.getBoundingClientRect().width, scrollRegionWidth: wrap.clientWidth, horizontalScroll: wrap.scrollLeft,
    callsignPinned: true, columnEditorOpen: !!controls, rowCount: table.querySelectorAll("tbody tr").length,
    context: new URLSearchParams(location.search).get("context") === "docked" ? "docked" : "detached" };
  wrap.scrollLeft = before;
  return result;
})();
