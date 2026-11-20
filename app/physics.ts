import Matter from 'matter-js';
import type { Phase, Settings } from './config';

const { Bodies, Body, Composite, Engine } = Matter;

export const TAU = Math.PI * 2;
export const STEP = 1 / 480;
const MATTER_STEP = 1 / 60;
export const WRAP = (angle: number, period = TAU) => ((angle % period) + period) % period;
export const START_ANGLE = -TAU / 4;
export const focusedIndex = (angle: number, count: number) => {
  if (!count) return -1;
  const width = TAU / count;
  return Math.floor(WRAP(width / 2 - angle) / width) % count;
};

export function randomUnit() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

export class WheelPhysics {
  engine = Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
  disk = Bodies.circle(0, 0, 40, { frictionAir: 0 });
  phase: Phase = 'idle';
  flex = 0;
  private flexSpeed = 0;
  private seconds = 0;
  private quietTime = 0;
  private launchDirection = 1;
  private motionSign = 1;
  private pegResistance = 1;
  private hitAt = -Infinity;
  private lastPeg = -Infinity;

  constructor() {
    Body.setAngle(this.disk, START_ANGLE);
    Composite.add(this.engine.world, this.disk);
  }

  get angle() { return this.disk.angle; }
  get velocity() { return Body.getAngularVelocity(this.disk) / MATTER_STEP; }

  start(hold: boolean, settings: Settings) {
    this.phase = hold ? 'charging' : 'coasting';
    this.quietTime = 0;
    this.launchDirection = randomUnit() < 0.5 ? -1 : 1;
    this.motionSign = this.launchDirection;
    this.pegResistance = 0.85 + randomUnit() * 0.45;
    this.lastPeg = -Infinity;
    this.hitAt = -Infinity;
    const launchSpeed = hold ? 0.9 : settings.launch * (0.8 + randomUnit() * 0.32);
    this.setVelocity(this.launchDirection * launchSpeed);
  }

  release(settings: Settings) {
    this.phase = 'coasting';
    const releaseSpeed = Math.max(7, this.velocity * this.launchDirection);
    const releaseBoost = (1.4 + randomUnit() * 5.5) * settings.launch / 28;
    this.setVelocity(this.launchDirection * (releaseSpeed + releaseBoost));
  }

  private setVelocity(speed: number) {
    Body.setAngularVelocity(this.disk, speed * MATTER_STEP);
  }

  step(count: number, radius: number, settings: Settings, onHit: (strength: number) => void) {
    const angle = this.angle;
    const speed = this.velocity;
    const spacing = TAU / count;
    const shifted = angle + spacing / 2;
    const pegDistance = WRAP(shifted + spacing / 2, spacing) - spacing / 2;
    // The peg/pointer overlap forms a cam. Its spring energy creates a torque
    // on both sides of the crest, so a slow wheel can bounce off a peg.
    const clearance = Math.min(spacing * 0.29, (settings.pegSize + 5 * settings.pointerSize / 100) / Math.max(radius - 11, 1));
    const inside = Math.abs(pegDistance) < clearance;
    const cam = inside ? Math.cos(pegDistance / clearance * Math.PI / 2) ** 2 : 0;
    const pegSpacingFactor = Math.min(1, spacing / (TAU / 8));
    const camEnergy = Math.min(
      0.18 * this.pegResistance * settings.impact * (settings.stiffness / 14) * pegSpacingFactor ** 1.25,
      180 * clearance ** 2,
    );
    // At high speed the elastic part of a full crossing cancels out. Sampling
    // it once on a narrow peg would alias into a spurious accelerating torque.
    const resolvesCam = Math.abs(speed) * STEP < clearance / 2;
    let camTorque = inside && resolvesCam
      ? Math.sin(pegDistance / clearance * Math.PI) * Math.PI / (2 * clearance) * camEnergy
      : 0;
    if (inside && Math.abs(speed) < 0.16 * Math.sqrt(pegSpacingFactor)) {
      const side = Math.sign(pegDistance) || this.motionSign;
      camTorque = side * Math.max(Math.abs(camTorque), settings.friction + 1.1);
    }

    const motor = this.phase === 'charging'
      ? this.launchDirection * (settings.acceleration * (1 - Math.max(0, speed * this.launchDirection) / settings.maxSpeed) + 2)
      : 0;
    const bearing = Math.sign(speed) * Math.min(Math.abs(speed) / STEP, settings.friction);
    const air = (settings.drag + 0.007 * Math.abs(speed)) * speed;
    const contactPressure = resolvesCam ? cam : clearance / spacing;
    // The pointer absorbs more of the remaining speed as a peg creeps past it.
    const slowContact = Math.max(0, 1 - Math.abs(speed) / 3);
    const contactLoss = (7 + 15 * slowContact) * this.pegResistance * settings.impact
      * contactPressure * speed * pegSpacingFactor;
    const acceleration = motor + camTorque - bearing - air - contactLoss;
    this.disk.torque = this.disk.inertia * acceleration / 1e6;
    Engine.update(this.engine, STEP * 1000);

    const change = this.angle - angle;
    this.seconds += STEP;
    if (Math.abs(change) > 0.000001) {
      const direction = Math.sign(change);
      this.motionSign = direction;
      // Sweep the whole step so fast-moving pegs cannot tunnel through the tip.
      const start = (shifted + direction * clearance) / spacing;
      const end = start + change / spacing;
      let peg = direction > 0 ? Math.floor(start) + 1 : Math.ceil(start) - 1;
      while (direction * (end - peg) >= 0) {
        if (peg !== this.lastPeg || this.seconds - this.hitAt > 0.085) {
          const strength = Math.min(1, 0.18 + Math.abs(speed) / 36);
          this.flexSpeed = direction * (6 + strength * 20) * settings.impact;
          this.lastPeg = peg;
          this.hitAt = this.seconds;
          onHit(strength);
        }
        peg += direction;
      }
    }

    const springRate = TAU * settings.stiffness;
    const deflection = this.motionSign * cam * 0.37 * Math.min(1.35, settings.impact);
    this.flexSpeed += ((deflection - this.flex) * springRate ** 2 - settings.damping * this.flexSpeed) * STEP;
    this.flex += this.flexSpeed * STEP;

    if (this.phase === 'coasting' && !inside && Math.abs(this.velocity) < 0.035) {
      this.setVelocity(0);
      this.quietTime += STEP;
      if (this.quietTime > 0.24 && Math.abs(this.flex) < 0.012 && Math.abs(this.flexSpeed) < 0.75) {
        this.phase = 'idle';
        this.flex = 0;
        this.flexSpeed = 0;
        Body.setAngle(this.disk, WRAP(this.angle));
        this.setVelocity(0);
      }
    } else {
      this.quietTime = 0;
    }
  }
}
