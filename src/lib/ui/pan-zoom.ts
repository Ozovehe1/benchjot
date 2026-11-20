// Screen transform for the map: screen = graph * k + (x, y).

export interface View {
  k: number;
  x: number;
  y: number;
}

const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Zooms by `factor` keeping the screen point (px, py) fixed. */
export function zoomAt(v: View, factor: number, px: number, py: number, min = MIN_ZOOM, max = MAX_ZOOM): View {
  const k = clamp(v.k * factor, min, max);
  const f = k / v.k;
  return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
}

/** A view that fits the points into a width x height box with `pad` px margin, never zoomed past 1.5. */
export function fitView(points: readonly { x: number; y: number }[], width: number, height: number, pad = 48, extra: { right?: number; bottom?: number } = {}): View {
  // `extra` keeps room for what is drawn beside the points: labels to the right, overlays at the bottom.
  const right = pad + (extra.right ?? 0);
  const bottom = pad + (extra.bottom ?? 0);
  const cx = (pad + width - right) / 2;
  const cy = (pad + height - bottom) / 2;
  if (points.length === 0) return { k: 1, x: cx, y: cy };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = clamp(Math.min((width - pad - right) / Math.max(x1 - x0, 1), (height - pad - bottom) / Math.max(y1 - y0, 1)), MIN_ZOOM, 1.5);
  return { k, x: cx - ((x0 + x1) / 2) * k, y: cy - ((y0 + y1) / 2) * k };
}

type Pt = { x: number; y: number };

/**
 * One pointer move: a single pointer pans; with a second pointer down (`other`), the pair
 * pinches around their midpoint and the midpoint's movement pans.
 */
export function dragStep(v: View, prev: Pt, next: Pt, other: Pt | null, min = MIN_ZOOM, max = MAX_ZOOM): View {
  if (!other) return { ...v, x: v.x + next.x - prev.x, y: v.y + next.y - prev.y };
  const before = Math.hypot(prev.x - other.x, prev.y - other.y);
  const after = Math.hypot(next.x - other.x, next.y - other.y);
  const mid0 = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
  const mid1 = { x: (next.x + other.x) / 2, y: (next.y + other.y) / 2 };
  let out = before > 0 ? zoomAt(v, after / before, mid0.x, mid0.y, min, max) : v;
  out = { ...out, x: out.x + mid1.x - mid0.x, y: out.y + mid1.y - mid0.y };
  return out;
}
