/** Keep native transparent bounds and the renderer's compact layout in agreement. */
export function barDimensions(count: number, size: number, orientation: 'vertical' | 'horizontal', collapsed = false): { width: number; height: number } {
  const cross = size + 28;
  const length = collapsed ? cross : 48 + Math.max(0, count) * 4 + (Math.max(0, count) + 1) * size;
  return orientation === 'horizontal' ? { width: length, height: cross } : { width: cross, height: length };
}
