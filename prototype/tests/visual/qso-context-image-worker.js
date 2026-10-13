// Fixture-scoped local image response: no request reaches an external service.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== "https://example.com" || !url.pathname.startsWith("/xlog-fixture-")) return;
  const height = url.pathname.includes("portrait") ? 450 : 180;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="${height}" viewBox="0 0 300 ${height}"><rect width="300" height="${height}" fill="#153e50"/><path d="M0 0L300 ${height}M300 0L0 ${height}" stroke="#35c8f5" stroke-width="4"/><circle cx="150" cy="${height / 2}" r="45" fill="#12d6a0"/><text x="150" y="${height - 15}" text-anchor="middle" fill="white" font-family="sans-serif" font-size="14">Synthetic image · 300 × ${height}</text></svg>`;
  event.respondWith(new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" } }));
});
