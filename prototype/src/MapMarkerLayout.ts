export type LabelPoint = { x: number; y: number; width?: number; height?: number };

/** Move labels, never their geographic anchor. Prefer the nearest free slot. */
export function expeditionLabelOffset(point: LabelPoint, placed: LabelPoint[], width: number, height: number, labelWidth = 140, labelHeight = 60): [number, number] {
  let best: [number, number] = [0, 0], bestScore = Infinity;
  for (let ring = 0; ring <= 10; ring++) {
    for (let row = -ring; row <= ring; row++) for (let column = -ring; column <= ring; column++) {
      if (Math.max(Math.abs(row), Math.abs(column)) !== ring) continue;
      const dx = column * (labelWidth + 8), dy = row * (labelHeight + 8);
      const candidate = { x: point.x + dx, y: point.y + dy };
      const outside = Math.max(0, labelWidth / 2 - candidate.x, candidate.x + labelWidth / 2 - width) + Math.max(0, labelHeight / 2 - candidate.y, candidate.y + labelHeight / 2 - height);
      const collisions = placed.filter(other => Math.abs(other.x - candidate.x) < (labelWidth + (other.width ?? 140)) / 2 + 4 && Math.abs(other.y - candidate.y) < (labelHeight + (other.height ?? 60)) / 2 + 4).length;
      const score = collisions * 100_000 + outside * 1000 + Math.hypot(dx * 1.3, dy);
      if (score < bestScore) { bestScore = score; best = [dx, dy]; }
    }
    if (bestScore < 1000) break;
  }
  placed.push({ x: point.x + best[0], y: point.y + best[1], width: labelWidth, height: labelHeight });
  return best;
}
