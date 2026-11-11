import type { Rectangle } from 'electron';

/** Keep the entire window reachable in the chosen display's logical work area. */
export function fitWindowBounds(bounds: Rectangle, area: Rectangle, minimum = { width: 450, height: 360 }): Rectangle {
  const finite = (value: number, fallback: number) => Number.isFinite(value) ? Math.round(value) : fallback;
  const width = Math.min(area.width, Math.max(Math.min(minimum.width, area.width), finite(bounds.width, minimum.width)));
  const height = Math.min(area.height, Math.max(Math.min(minimum.height, area.height), finite(bounds.height, minimum.height)));
  const x = Math.max(area.x, Math.min(finite(bounds.x, area.x), area.x + area.width - width));
  const y = Math.max(area.y, Math.min(finite(bounds.y, area.y), area.y + area.height - height));
  return { x, y, width, height };
}
