import Matter from 'matter-js';
import type { Phase, Settings } from './config';
import { PEG_INSET, POINTER_OFFSET, pointerContact, pointerLanding, pointerTipAzimuth, pointerTriangle, wheelPegs } from './pointer-contact';

const { Bodies, Body, Composite, Engine } = Matter;

export const TAU = Math.PI * 2;
export const STEP = 1 / 480;
const MATTER_STEP = 1 / 60;
export const WRAP = (angle: number, period = TAU) => ((angle % period) + period) % period;
export const START_ANGLE = -TAU / 4;
export type SpinDirection = 1 | -1;
export function wheelSectors(count: number, weights: number[] | null) {
  const total = weights ? weights.reduce((sum, weight) => sum + weight, 0) : count;
  const firstWidth = TAU * (weights?.[0] ?? 1) / total;
  let start = -firstWidth / 2;
  return Array.from({ length: count }, (_, index) => {
    const share = (weights?.[index] ?? 1) / total;
    const end = index === count - 1 ? TAU - firstWidth / 2 : start + share * TAU;
    const sector = { start, end, center: (start + end) / 2, share };
    start = end;
    return sector;
  });
}

export type Sector = ReturnType<typeof wheelSectors>[number];

function sectorAt(position: number, sectors: Sector[]) {
  let low = 0;
  let high = sectors.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (position < sectors[middle].end) high = middle;
    else low = middle + 1;
  }
  return low;
}

export function focusedIndex(angle: number, sectors: Sector[]) {
  if (!sectors.length) return -1;
  const origin = sectors[0].start;
  return sectorAt(origin + WRAP(-angle - origin), sectors);
}

function pegPosition(angle: number, sectors: Sector[]) {
  const origin = sectors[0].start;
  const turn = Math.floor((-angle - origin) / TAU);
  const position = origin + WRAP(-angle - origin);
  const index = sectorAt(position, sectors);
  const { start, end } = sectors[index];
  return { position, index, turn, start, end };
}

export class WheelPhysics {
  engine = Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
  disk = Bodies.circle(0, 0, 40, { frictionAir: 0 });
  phase: Phase = 'idle';
  pointerAngle = 0;
  private pointerSpeed = 0;
  private seconds = 0;
  private quietTime = 0;
  private pointerQuietTime = 0;
  private launchDirection = 1;
  private motionSign = 1;
  pointerContactSwing = 0;
  private geometry: {
    sectors: Sector[];
    radius: number;
    settings: Settings;
    triangle: ReturnType<typeof pointerTriangle>;
    pegs: ReturnType<typeof wheelPegs>;
  } | null = null;
  private hitAt = -Infinity;
  private lastPeg = -Infinity;
  private target: number | null = null;
  private landing: { from: number; distance: number; duration: number; slope: number; elapsed: number; blade: number; swing: number } | null = null;

  constructor() {
    Body.setAngle(this.disk, START_ANGLE);
    Composite.add(this.engine.world, this.disk);
  }

  get angle() { return this.disk.angle; }
  get velocity() { return Body.getAngularVelocity(this.disk) / MATTER_STEP; }

  start(hold: boolean, settings: Settings, target: number | null, direction: SpinDirection) {
    this.phase = hold ? 'charging' : 'coasting';
    this.quietTime = 0;
    this.pointerQuietTime = 0;
    this.launchDirection = direction;
    this.motionSign = this.launchDirection;
    this.lastPeg = -Infinity;
    this.pointerContactSwing = 0;
    this.hitAt = -Infinity;
    this.target = target;
    this.landing = null;
    const launchSpeed = hold ? 0.9 : settings.launch;
    this.setVelocity(this.launchDirection * launchSpeed);
  }

  release() {
    this.phase = 'coasting';
    const releaseSpeed = Math.max(7, this.velocity * this.launchDirection);
    this.setVelocity(this.launchDirection * releaseSpeed);
  }

  private setVelocity(speed: number) {
    Body.setAngularVelocity(this.disk, speed * MATTER_STEP);
  }

  step(sectors: Sector[], radius: number, settings: Settings, onHit: (strength: number) => void) {
    if (!this.geometry || this.geometry.sectors !== sectors || this.geometry.radius !== radius || this.geometry.settings !== settings) {
      this.geometry = {
        sectors, radius, settings,
        triangle: pointerTriangle(settings.pointerSize / 100, settings.pegSize),
        pegs: wheelPegs(sectors, radius, settings.pegSize),
      };
    }
    const pivot = radius + POINTER_OFFSET;
    const tightness = settings.pivotTightness / 100;
    const angle = this.angle;
    const speed = this.velocity;
    const { position, index, start, end } = pegPosition(angle, sectors);
    const nearStart = position - start < end - position;
    const neighbor = sectors[(index + (nearStart ? sectors.length - 1 : 1)) % sectors.length];
    const spacing = Math.min(end - start, neighbor.end - neighbor.start);
    const pegDistance = (nearStart ? start : end) - position;
    // The peg/pointer overlap forms a cam. Its spring energy creates a torque
    // on both sides of the crest, so a slow wheel can bounce off a peg.
    const clearance = Math.min(spacing * 0.44, (settings.pegSize + 2.6 + 7 * settings.pointerSize / 100) / Math.max(radius - PEG_INSET, 1));
    const inside = Math.abs(pegDistance) < clearance;
    const cam = inside ? Math.cos(pegDistance / clearance * Math.PI / 2) ** 2 : 0;
    const pegSpacingFactor = Math.min(1, spacing / (TAU / 8));
    const camEnergy = Math.min(
      (0.009 + tightness * 0.022) * pegSpacingFactor ** 1.25,
      180 * clearance ** 2,
    );
    // At high speed the elastic part of a full crossing cancels out. Sampling
    // it once on a narrow peg would alias into a spurious accelerating torque.
    const resolvesCam = Math.abs(speed) * STEP < clearance / 2;
    const camTorque = inside && resolvesCam
      ? Math.sin(pegDistance / clearance * Math.PI) * Math.PI / (2 * clearance) * camEnergy
      : 0;


    const motor = this.phase === 'charging'
      ? this.launchDirection * (settings.acceleration * (1 - Math.max(0, speed * this.launchDirection) / settings.maxSpeed) + 2)
      : 0;
    const bearing = Math.sign(speed) * Math.min(Math.abs(speed) / STEP, settings.friction);
    const air = (settings.drag + 0.014 * Math.abs(speed)) * speed;
    const contactPressure = resolvesCam ? cam : clearance / spacing;
    // Keep energy loss consistent so the spring decides whether a slow peg clears the pointer.
    const contactLoss = (0.45 + tightness * 0.65) * contactPressure * speed * pegSpacingFactor;
    const acceleration = motor + camTorque - bearing - air - contactLoss;
    // Pick the weighted outcome before spinning. Guide the final coast to its sector
    // so the peg forces and spin settings cannot change the selected probabilities.
    const forwardSpeed = speed * this.launchDirection;
    if (this.phase === 'coasting' && !this.landing) {
      if (this.target !== null && forwardSpeed > 0 && forwardSpeed < 2) {
        const swing = -this.launchDirection;
        const pose = pointerLanding(-this.target, pivot, this.geometry.pegs, this.geometry.triangle, swing);
        const distance = WRAP((pose.angle - angle) * this.launchDirection);
        const duration = Math.max(STEP, Math.min(7, 2.5 * distance / forwardSpeed));
        const slope = Math.min(3, forwardSpeed * duration / Math.max(distance, 1e-9));
        this.landing = { from: angle, distance: distance * this.launchDirection, duration, slope, elapsed: 0, blade: pose.blade, swing };
      } else if (this.target === null && inside && Math.abs(speed) < 0.035) {
        // A stalled peg releases into the sector on the blade's side of it.
        const tipAzimuth = pointerTipAzimuth(pivot, this.geometry.triangle[1], this.pointerAngle);
        const pointed = sectors[focusedIndex(angle - tipAzimuth, sectors)];
        const swing = this.pointerContactSwing || Math.sign(this.pointerAngle) || -this.motionSign;
        const pose = pointerLanding(pointed.center, pivot, this.geometry.pegs, this.geometry.triangle, swing);
        const distance = WRAP(pose.angle - angle + Math.PI) - Math.PI;
        const duration = Math.max(0.32, Math.min(1.05, 2 * Math.sqrt(Math.abs(distance))));
        this.landing = { from: angle, distance, duration, slope: 0, elapsed: 0, blade: pose.blade, swing };
      }
    }
    const landing = this.landing;
    let landingProgress = 0;
    if (landing) {
      landing.elapsed += STEP;
      const t = Math.min(1, landing.elapsed / landing.duration);
      landingProgress = t;
      const progress = t * (t * (3 - 2 * t) + landing.slope * (1 - t) ** 2);
      const next = landing.from + landing.distance * progress;
      Body.setAngle(this.disk, next);
      this.setVelocity(t === 1 ? 0 : (next - angle) / STEP);
    } else {
      this.disk.torque = this.disk.inertia * acceleration / 1e6;
      Engine.update(this.engine, STEP * 1000);
    }

    const change = this.angle - angle;
    this.seconds += STEP;
    if (Math.abs(change) > 0.000001) {
      const direction = Math.sign(change);
      this.motionSign = direction;
      // Sweep the whole step so fast-moving pegs cannot tunnel through the tip.
      const count = sectors.length;
      const sweepStart = pegPosition(angle + direction * clearance, sectors);
      const sweepEnd = -this.angle - direction * clearance;
      let peg = sweepStart.turn * count + sweepStart.index + (direction < 0 ? 1 : 0);
      for (;;) {
        const boundary = sectors[WRAP(peg, count)].start + Math.floor(peg / count) * TAU;
        if (direction * (boundary - sweepEnd) < 0) break;
        if (peg !== this.lastPeg || this.seconds - this.hitAt > 0.085) {
          const strength = Math.min(1, 0.18 + Math.abs(speed) / 36);
          this.pointerSpeed -= direction * strength * (3 - tightness * 1.5);
          this.lastPeg = peg;
          this.hitAt = this.seconds;
          onHit(strength);
        }
        peg -= direction;
      }
    }

    const springRate = 16 + tightness * 18;
    const damping = 9 + tightness * 22;
    this.pointerSpeed -= (this.pointerAngle * springRate ** 2 + damping * this.pointerSpeed) * STEP;
    const springAngle = this.pointerAngle + this.pointerSpeed * STEP;
    const guide = Math.max(0, (landingProgress - 0.7) / 0.3) ** 2;
    const freeAngle = landing ? springAngle + (landing.blade - springAngle) * guide : springAngle;
    const swing = landing && guide > 0 ? landing.swing : this.pointerContactSwing || -this.motionSign;
    const contact = pointerContact(this.angle, pivot, this.geometry.pegs, this.geometry.triangle, freeAngle, swing);
    this.pointerContactSwing = contact.touching ? swing : 0;
    if (contact.angle !== freeAngle) {
      const push = Math.sign(contact.angle - freeAngle);
      const pushedSpeed = (contact.angle - this.pointerAngle) * push / STEP;
      // A peg can push the blade open, but cannot pull it shut after passing.
      this.pointerSpeed = push * Math.min(9 - tightness * 4, Math.max(0, change ? pushedSpeed : 0));
    }
    this.pointerAngle = contact.angle;
    if (landingProgress === 1) this.pointerSpeed = 0;

    if (this.phase === 'coasting' && (landing ? landing.elapsed >= landing.duration : !inside && Math.abs(this.velocity) < 0.009)) {
      this.setVelocity(0);
      this.quietTime += STEP;
      this.pointerQuietTime = Math.abs(this.pointerSpeed) < 0.14 ? this.pointerQuietTime + STEP : 0;
      if (this.quietTime > 0.24 && this.pointerQuietTime > 0.08) {
        this.phase = 'idle';
        if (!landing && Math.abs(this.pointerAngle) < 0.012) this.pointerAngle = 0;
        this.pointerSpeed = 0;
        Body.setAngle(this.disk, WRAP(this.angle));
        this.setVelocity(0);
      }
    } else {
      this.quietTime = 0;
      this.pointerQuietTime = 0;
    }
  }
}
