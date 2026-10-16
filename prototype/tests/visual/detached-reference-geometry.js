// Run with agent-browser eval --stdin on a detached reference/status surface.
// This checks rendered geometry; jsdom cannot detect chart-row misalignment.
(() => {
  const surface = new URLSearchParams(location.search).get("view");
  if (!["station-identity", "antenna", "propagation", "station-status", "rotor"].includes(surface))
    throw new Error("A detached reference/status surface is required");
  const main = document.querySelector("main");
  if (!main) throw new Error("Detached content did not mount");
  const failures = [];
  const box = main.getBoundingClientRect();
  if (box.x !== 0 || box.y !== 0 || Math.abs(box.width - innerWidth) > 1 || Math.abs(box.height - innerHeight) > 1)
    failures.push("Detached content does not fill the viewport");
  if (document.querySelector("header, .detached-window-head, h1, h2"))
    failures.push("Redundant in-app window chrome");
  const first = main.firstElementChild?.getBoundingClientRect();
  if (!first || Math.abs(first.x - 12) > 1 || Math.abs(first.y - 12) > 1)
    failures.push("Content does not start at the shared 12px inset");
  for (const element of [main, ...main.querySelectorAll("section, dl, .condition-bands, .detached-rotor-details")])
    if (element.scrollWidth > element.clientWidth + 1) failures.push(`${element.className || element.tagName}: horizontal overflow`);
  const columns = [...main.querySelectorAll(".condition-bands > div")];
  if (columns.length) {
    const rowPositions = columns.map(column => [...column.children].map(child => child.getBoundingClientRect().y));
    for (const row of [0, 1, 2]) {
      const positions = rowPositions.map(position => position[row]);
      if (Math.max(...positions) - Math.min(...positions) > 1)
        failures.push(`Propagation row ${row} does not align with its legend`);
    }
  }
  const result = { surface, width: innerWidth, height: innerHeight, passed: !failures.length, failures };
  if (failures.length) throw new Error(JSON.stringify(result));
  return result;
})();
