type Point = { x: number; y: number };
export type Peg = Point & { radius: number };

export const POINTER_OFFSET = 18;
export const POINTER_STROKE = 4;
export const PEG_INSET = 11;
export const PEG_STROKE = 1.2;
export const PEG_STROKE_THRESHOLD = 2.8;
const MAX_SWING = Math.PI / 2;

export function pointerTriangle(scale: number, pegSize: number) {
  return [
    { x: 2 * scale, y: -12 * scale },
    { x: -(6 * scale + POINTER_OFFSET + PEG_INSET + pegSize), y: 0 },
    { x: 2 * scale, y: 12 * scale },
  ];
}

export function pointerTipAzimuth(pivot: number, tip: Point, angle: number) {
  return Math.atan2(tip.x * Math.sin(angle), pivot + tip.x * Math.cos(angle));
}

export function wheelPegs(sectors: { start: number; end: number }[], radius: number, pegSize: number): Peg[] {
  const ring = Math.max(1, radius - PEG_INSET);
  return sectors.map(({ start, end }, index) => {
    const previous = sectors[(index + sectors.length - 1) % sectors.length];
    return {
      x: ring * Math.cos(start),
      y: ring * Math.sin(start),
      radius: Math.min(pegSize, 0.34 * Math.min(end - start, previous.end - previous.start) * ring),
    };
  });
}

function overlaps(peg: Peg, triangle: Point[], angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Rotate the peg into the unrotated triangle's local coordinates.
  const x = peg.x * cos + peg.y * sin;
  const y = peg.y * cos - peg.x * sin;
  let inside = true;
  for (let i = 0; i < triangle.length; i++) {
    const a = triangle[i];
    const b = triangle[(i + 1) % triangle.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const px = x - a.x;
    const py = y - a.y;
    if (dx * py - dy * px > 0) inside = false;
    const fraction = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
    if ((px - fraction * dx) ** 2 + (py - fraction * dy) ** 2 < peg.radius ** 2) return true;
  }
  return inside;
}

export function pointerContact(rotation: number, pivot: number, pegs: Peg[], triangle: Point[], springAngle: number, swing: number) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const reach = -triangle[1].x;
  const nearby: Peg[] = [];
  for (const peg of pegs) {
    const x = peg.x * cos - peg.y * sin - pivot;
    const y = peg.x * sin + peg.y * cos;
    const outline = peg.radius >= PEG_STROKE_THRESHOLD ? PEG_STROKE / 2 : 0;
    const radius = peg.radius + outline + POINTER_STROKE / 2 + 0.25;
    if (x * x + y * y <= (reach + radius) ** 2) nearby.push({ x, y, radius });
  }

  const blocked = (angle: number) => nearby.some((peg) => overlaps(peg, triangle, angle));
  const neutralBlocked = blocked(0);
  const requested = neutralBlocked ? swing * Math.max(0, springAngle * swing) : springAngle;
  if (!blocked(requested)) return { angle: requested, touching: neutralBlocked };

  // At 90° the entire blade lies outside the peg track. Keep a known
  // clear angle on the side the blade was pushed, even with adjacent pegs.
  const direction = neutralBlocked ? swing : Math.sign(requested) || swing;
  let clear = MAX_SWING;
  let overlap = Math.abs(requested);
  for (let i = 0; i < 16; i++) {
    const middle = (clear + overlap) / 2;
    if (blocked(direction * middle)) overlap = middle;
    else clear = middle;
  }
  return { angle: direction * clear, touching: neutralBlocked };
}


// Keep the tip on the requested dial coordinate even when a narrow sector
// only has room for the blade at an angle.
export function pointerLanding(dialPosition: number, pivot: number, pegs: Peg[], triangle: Point[], swing: number) {
  const poseAt = (angle: number) => ({
    angle: pointerTipAzimuth(pivot, triangle[1], angle) - dialPosition,
    blade: angle,
  });
  const fits = (pose: ReturnType<typeof poseAt>) =>
    pointerContact(pose.angle, pivot, pegs, triangle, pose.blade, swing).angle === pose.blade;
  const neutral = poseAt(0);
  if (fits(neutral)) return neutral;

  let blocked = 0;
  let clear = MAX_SWING;
  for (let i = 0; i < 16; i++) {
    const middle = (blocked + clear) / 2;
    if (fits(poseAt(swing * middle))) clear = middle;
    else blocked = middle;
  }
  return poseAt(swing * clear);
}
