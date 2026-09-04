import type { FxKind } from "./fxBus";

/**
 * A small pooled particle system for the replay board.
 *
 * Pooled because the alternative is allocating a few hundred short-lived
 * objects on every attack and handing the garbage collector a reason to stall
 * exactly when the board is at its busiest. Particles are recycled from a
 * fixed array; when it's full the oldest is overwritten, which caps the cost
 * of a pathological log rather than letting it grow unbounded.
 *
 * Everything is drawn additively (`lighter`), so overlapping particles bloom
 * toward white the way real sparks do instead of muddying into grey.
 */

const MAX_PARTICLES = 420;
const MAX_RINGS = 24;

interface Particle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Downward pull. Zero for sparks that should hang, positive for debris. */
  gravity: number;
  /** Velocity retained per frame — the medium's thickness. */
  drag: number;
  age: number;
  life: number;
  size: number;
  color: string;
  /** Long thin shard along its direction of travel, vs a round spark. */
  shard: boolean;
}

interface Ring {
  alive: boolean;
  x: number;
  y: number;
  age: number;
  life: number;
  radius: number;
  maxRadius: number;
  width: number;
  color: string;
}

function makeParticle(): Particle {
  return {
    alive: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    gravity: 0,
    drag: 0.94,
    age: 0,
    life: 1,
    size: 2,
    color: "#fff",
    shard: false,
  };
}

function makeRing(): Ring {
  return {
    alive: false,
    x: 0,
    y: 0,
    age: 0,
    life: 1,
    radius: 0,
    maxRadius: 60,
    width: 2,
    color: "#fff",
  };
}

export class ParticleSystem {
  private particles: Particle[] = Array.from({ length: MAX_PARTICLES }, makeParticle);
  private rings: Ring[] = Array.from({ length: MAX_RINGS }, makeRing);
  private pCursor = 0;
  private rCursor = 0;

  /** True while anything is still on screen — lets the canvas stop its rAF
   *  loop when the board is quiet instead of burning a frame budget to draw
   *  nothing. */
  get busy(): boolean {
    return (
      this.particles.some((p) => p.alive) || this.rings.some((r) => r.alive)
    );
  }

  private spawn(): Particle {
    // Round-robin over the pool. A full pool overwrites its oldest entry,
    // which is the right failure mode: the newest burst is the one the
    // viewer is looking at.
    const p = this.particles[this.pCursor];
    this.pCursor = (this.pCursor + 1) % MAX_PARTICLES;
    return p;
  }

  private spawnRing(): Ring {
    const r = this.rings[this.rCursor];
    this.rCursor = (this.rCursor + 1) % MAX_RINGS;
    return r;
  }

  emit(kind: FxKind, x: number, y: number, intensity: number, color: string, scale: number): void {
    switch (kind) {
      case "impact":
        this.impact(x, y, intensity, color, scale);
        break;
      case "converge":
        this.converge(x, y, intensity, color, scale);
        break;
      case "debris":
        this.debris(x, y, intensity, color, scale);
        break;
      case "spark":
        this.spark(x, y, intensity, color, scale);
        break;
    }
  }

  /** A blow landing. Shards fly outward fast and die fast; the ring is the
   *  shockwave that makes the hit read as concussive rather than sparkly. */
  private impact(x: number, y: number, intensity: number, color: string, scale: number): void {
    const count = Math.round(26 + 34 * intensity);
    for (let i = 0; i < count; i++) {
      const p = this.spawn();
      const angle = Math.random() * Math.PI * 2;
      // Squared random biases most shards slow with a few fliers, which
      // looks like debris; a flat distribution looks like a firework.
      const speed = (2 + Math.random() * Math.random() * 13 * (0.6 + intensity)) * scale;
      p.alive = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.gravity = 0.16 * scale;
      p.drag = 0.9;
      p.age = 0;
      p.life = 26 + Math.random() * 22;
      p.size = (1.1 + Math.random() * 2.2) * scale;
      p.color = i % 4 === 0 ? "#ffffff" : color;
      p.shard = true;
    }
    const ring = this.spawnRing();
    ring.alive = true;
    ring.x = x;
    ring.y = y;
    ring.age = 0;
    ring.life = 22;
    ring.radius = 4 * scale;
    ring.maxRadius = (46 + 52 * intensity) * scale;
    ring.width = 3 * scale;
    ring.color = color;
  }

  /** Energy arriving. Particles start on a circle and fall inward, so the
   *  card reads as receiving something rather than shedding it. */
  private converge(x: number, y: number, intensity: number, color: string, scale: number): void {
    const count = Math.round(20 + 16 * intensity);
    for (let i = 0; i < count; i++) {
      const p = this.spawn();
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const dist = (44 + Math.random() * 34) * scale;
      const speed = (1.9 + Math.random() * 1.5) * scale;
      p.alive = true;
      p.x = x + Math.cos(angle) * dist;
      p.y = y + Math.sin(angle) * dist;
      p.vx = -Math.cos(angle) * speed;
      p.vy = -Math.sin(angle) * speed;
      p.gravity = 0;
      // Above 1 — they accelerate as they close, which reads as being pulled
      // in rather than drifting in.
      p.drag = 1.045;
      p.age = 0;
      p.life = 26 + Math.random() * 8;
      p.size = (1.4 + Math.random() * 1.6) * scale;
      p.color = color;
      p.shard = false;
    }
  }

  /** A Pokémon knocked out. Slower, heavier, and it falls — this is wreckage,
   *  not a spark shower. */
  private debris(x: number, y: number, intensity: number, color: string, scale: number): void {
    const count = Math.round(30 + 26 * intensity);
    for (let i = 0; i < count; i++) {
      const p = this.spawn();
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
      const speed = (2 + Math.random() * 7) * scale;
      p.alive = true;
      p.x = x + (Math.random() - 0.5) * 30 * scale;
      p.y = y + (Math.random() - 0.5) * 40 * scale;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.gravity = 0.42 * scale;
      p.drag = 0.965;
      p.age = 0;
      p.life = 44 + Math.random() * 30;
      p.size = (1.6 + Math.random() * 3.4) * scale;
      p.color = i % 5 === 0 ? "#ffffff" : color;
      p.shard = true;
    }
    const ring = this.spawnRing();
    ring.alive = true;
    ring.x = x;
    ring.y = y;
    ring.age = 0;
    ring.life = 30;
    ring.radius = 6 * scale;
    ring.maxRadius = 110 * scale;
    ring.width = 4 * scale;
    ring.color = color;
  }

  /** A small pop — an ability firing, a prize claimed. */
  private spark(x: number, y: number, intensity: number, color: string, scale: number): void {
    const count = Math.round(12 + 10 * intensity);
    for (let i = 0; i < count; i++) {
      const p = this.spawn();
      const angle = Math.random() * Math.PI * 2;
      const speed = (1 + Math.random() * 4) * scale;
      p.alive = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed - 0.6 * scale;
      p.gravity = 0.05 * scale;
      p.drag = 0.93;
      p.age = 0;
      p.life = 24 + Math.random() * 16;
      p.size = (1 + Math.random() * 1.8) * scale;
      p.color = color;
      p.shard = false;
    }
  }

  /**
   * Advance and draw.
   *
   * `dt` is in frames-at-60fps rather than milliseconds, so the tuning
   * constants above read as "pixels per frame" — the units anyone actually
   * thinks in when tuning a particle by eye — while still staying correct on
   * a 120Hz display or through a dropped frame.
   */
  step(ctx: CanvasRenderingContext2D, dt: number): void {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    for (const p of this.particles) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      const dragged = Math.pow(p.drag, dt);
      p.vx *= dragged;
      p.vy *= dragged;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const t = p.age / p.life;
      // Fades on a curve, not linearly: a linear fade spends half its life
      // clearly visible and then vanishes, which looks like a cut.
      const alpha = Math.max(0, 1 - t * t);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;

      if (p.shard) {
        // Stretched along its own velocity, so fast debris streaks and slow
        // debris stays a chip.
        const speed = Math.hypot(p.vx, p.vy);
        const len = Math.min(14, p.size + speed * 0.9);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillRect(-len / 2, -p.size / 2, len, p.size);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const r of this.rings) {
      if (!r.alive) continue;
      r.age += dt;
      if (r.age >= r.life) {
        r.alive = false;
        continue;
      }
      const t = r.age / r.life;
      // Decelerating expansion — a shockwave loses energy as it spreads.
      const eased = 1 - Math.pow(1 - t, 3);
      ctx.globalAlpha = Math.max(0, 1 - t) * 0.75;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(0.5, r.width * (1 - t));
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius + (r.maxRadius - r.radius) * eased, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  clear(): void {
    for (const p of this.particles) p.alive = false;
    for (const r of this.rings) r.alive = false;
  }
}
