// agent-browser eval --stdin, synthetic fixture only; inspect without editing data.
(() => {
  if (!location.pathname.endsWith("/qso-context-preview.html")) throw new Error("Synthetic fixture required");
  const summary = document.querySelector(".qso-profile-summary");
  const identity = document.querySelector(".qso-profile-identity");
  const image = document.querySelector(".qso-profile-photo");
  const notes = document.querySelector("textarea[aria-label='QSO note']");
  const footer = document.querySelector(".sidebar-foot");
  const expectedNote = `First line\n  ${"LongUnbrokenNote".repeat(60)}\nLast line  `;
  const errors = [];
  if (notes.scrollWidth > notes.clientWidth + 1) errors.push("Notes scroll horizontally");
  if (notes.value !== expectedNote) errors.push("Note text changed");
  if (getComputedStyle(identity).textAlign !== "right") errors.push("Identity is not right aligned");
  if (getComputedStyle(footer).textAlign !== "center") errors.push("Station identity is not centered");
  if (summary.scrollWidth > summary.clientWidth + 1) errors.push("Profile overflows");
  if (image) {
    if (!image.complete || !image.naturalWidth) errors.push("Image did not load");
    const box = image.getBoundingClientRect();
    if (Math.abs(box.width - summary.clientWidth) > 1) errors.push("Image does not fill content width");
    if (identity.getBoundingClientRect().top < box.bottom) errors.push("Identity is not below image");
    if (Math.abs(box.width / box.height - image.naturalWidth / image.naturalHeight) > .01) errors.push("Image aspect ratio changed");
  } else if (new URLSearchParams(location.search).get("photo") !== "none") errors.push("Expected image missing");
  return { passed: errors.length === 0, errors, viewport: innerWidth, photo: new URLSearchParams(location.search).get("photo") ?? "landscape",
    imageWidth: image?.getBoundingClientRect().width, noteWidth: notes.clientWidth, noteScrollWidth: notes.scrollWidth };
})();
