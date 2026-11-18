// the ascii fish school for the knowledge inbox background.
// pure typescript: no dom, no renderer. the sim is a function of
// the wall clock, so the school is correct at any render cadence.

/** one grid cell, in css pixels. the renderer snaps it to the 14px grid. */
export const CELL = 14;

export const BODY_GLYPHS = ["%", "8", "#", "X", "@", "S"];
export const WAKE_GLYPHS = ["t", "o", ":", ";", ".", "'", ","];

const GOLD_TILES = ["#544838", "#5a4e3e", "#635645", "#6a5c4a", "#71634f"];
const GOLD_GLYPH = "#eee5d7";

const BLUE_TILES = ["#343a4e", "#3a4157", "#414860", "#485069", "#4f5773"];
const BLUE_GLYPH = "#e2e6fa";

const SPARKLE_TILE = "#5a4d78";
const SPARKLE_GLYPH = "#d8b4fe";

const WAKE_GLYPH_COLOR = "#8c90a4";

const BLUR_COLOR = "#3c4156";

const OMEGA = 0.052;
const WAKE_STEPS = 10;
const WAKE_STEP_SECONDS = 0.16;

export type FishKind = "large" | "medium" | "small";
export type CellKind = "body" | "wake" | "fringe";

export interface FishCell {
  x: number;
  y: number;
  glyph: string;
  glyphColor: string;
  tileColor: string;
  alpha: number;
  kind: CellKind;
}

interface Fish {
  id: number;
  kind: FishKind;
  family: "gold" | "blue";
  theta0: number;
  omega: number;
  rx: number;
  ry: number;
  scale: number;
  phase: number;
  sparklePeriod: number;
  leaderId: number;
  lag: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** deterministic per-cell hash. same inputs give the same value. */
function hash01(a: number, b: number): number {
  const n = (Math.imul(a, 374761393) + Math.imul(b + 7919, 668265263)) >>> 0;
  return (Math.imul(n ^ (n >>> 13), 1274126177) >>> 0) / 4294967296;
}

/**
 * the fish school. positions are a function of the wall clock.
 * call update(t) once per frame; read cells[0..cellCount).
 */
export class School {
  /** reusable cell pool. the renderer reads index 0..cellCount. */
  cells: FishCell[] = [];
  cellCount = 0;
  /** the out-of-focus fish, drawn large and blurred on a lower layer. */
  blurCells: FishCell[] = [];
  blurCellCount = 0;

  width: number;
  height: number;

  private fish: Fish[] = [];
  private blurFish: Fish[] = [];
  private rand: () => number;

  constructor(width: number, height: number, seed = 42) {
    this.width = width;
    this.height = height;
    this.rand = mulberry32(seed);
    this.buildFish();
    this.buildBlurFish();
    this.update(0);
  }

  resize(width: number, height: number): void {
    const sx = width / this.width;
    const sy = height / this.height;
    this.width = width;
    this.height = height;
    for (const f of this.fish) {
      f.rx *= sx;
      f.ry *= sy;
    }
    for (const f of this.blurFish) {
      f.rx *= sx;
      f.ry *= sy;
    }
    this.update(0);
  }

  /** angle on the ellipse at time t. grows by omega per second, ccw on screen. */
  private thetaAt(f: Fish, t: number): number {
    return f.theta0 - f.omega * t;
  }

  /** angle for small fish: tail the leader with a fixed lag and a wobble. */
  private leaderThetaAt(f: Fish, t: number): number {
    if (f.leaderId < 0) return this.thetaAt(f, t);
    const leader = this.fish.find((o) => o.id === f.leaderId);
    if (!leader) return this.thetaAt(f, t);
    return this.thetaAt(leader, t) + f.lag + Math.sin(t * 0.5 + f.phase) * 0.015;
  }

  /** position on the ellipse, with radial sway when requested. */
  private positionAt(f: Fish, t: number, sway: boolean): { x: number; y: number } {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const theta = this.leaderThetaAt(f, t);
    const s = sway ? Math.sin(t * 0.6 + f.phase) * 10 : 0;
    const vx = Math.sin(theta);
    const vy = -Math.cos(theta);
    return {
      x: cx + f.rx * Math.cos(theta) + vx * s,
      y: cy + f.ry * Math.sin(theta) + vy * s,
    };
  }

  private buildFish(): void {
    const starts: { kind: FishKind; family: "gold" | "blue"; theta: number; scale: number }[] = [
      { kind: "large", family: "gold", theta: (3 * Math.PI) / 2 + 0.15, scale: 1.3 },
      { kind: "large", family: "blue", theta: (7 * Math.PI) / 4 + 0.2, scale: 1.25 },
      { kind: "large", family: "gold", theta: 0.15, scale: 1.3 },
      { kind: "large", family: "blue", theta: Math.PI / 2 - 0.2, scale: 1.25 },
      { kind: "medium", family: "gold", theta: (3 * Math.PI) / 4 + 0.1, scale: 1.0 },
      { kind: "medium", family: "blue", theta: Math.PI - 0.35, scale: 1.0 },
      { kind: "medium", family: "gold", theta: (3 * Math.PI) / 2 - 0.75, scale: 0.95 },
    ];
    const rx = 0.44 * this.width;
    const ry = 0.41 * this.height;
    this.fish = starts.map((s, i) => this.makeFish(i, s.kind, s.family, s.theta, rx, ry, s.scale));

    const largeIds = this.fish.filter((f) => f.kind === "large").map((f) => f.id);
    for (let i = 0; i < 5; i++) {
      const leader = largeIds[i % largeIds.length];
      const f = this.makeFish(
        starts.length + i,
        "small",
        this.rand() < 0.5 ? "gold" : "blue",
        0,
        rx,
        ry,
        0.72,
      );
      f.leaderId = leader;
      f.lag = 0.035 + this.rand() * 0.05;
      f.omega = this.fish[leader].omega;
      this.fish.push(f);
    }
  }

  private buildBlurFish(): void {
    const rx = 0.44 * this.width;
    const ry = 0.41 * this.height;
    const thetas = [Math.PI - 0.6, Math.PI + 0.4, -0.4];
    this.blurFish = thetas.map((theta, i) =>
      this.makeFish(i + 100, "large", i === 1 ? "blue" : "gold", theta, rx, ry, 1.7),
    );
  }

  private makeFish(
    id: number,
    kind: FishKind,
    family: "gold" | "blue",
    theta: number,
    rx: number,
    ry: number,
    scale: number,
  ): Fish {
    const jitter = 0.94 + this.rand() * 0.12;
    return {
      id,
      kind,
      family,
      theta0: theta,
      omega: OMEGA * (0.9 + this.rand() * 0.2),
      rx: rx * jitter,
      ry: ry * jitter,
      scale,
      phase: this.rand() * Math.PI * 2,
      sparklePeriod: 2.6 + this.rand() * 1.4,
      leaderId: -1,
      lag: 0,
    };
  }

  private ensurePool(): void {
    while (this.cells.length < 2400) {
      this.cells.push({
        x: 0,
        y: 0,
        glyph: " ",
        glyphColor: "#000000",
        tileColor: "#000000",
        alpha: 0,
        kind: "body",
      });
    }
    while (this.blurCells.length < 900) {
      this.blurCells.push({
        x: 0,
        y: 0,
        glyph: " ",
        glyphColor: "#000000",
        tileColor: "#000000",
        alpha: 0,
        kind: "body",
      });
    }
  }

  /** paint the school at time t in seconds. */
  update(t: number): void {
    this.ensurePool();
    this.cellCount = 0;
    this.blurCellCount = 0;

    for (const f of this.fish) this.emitFish(f, t);
    for (const f of this.blurFish) this.emitBlurFish(f, t);
  }

  private emitFish(f: Fish, t: number): void {
    const center = this.positionAt(f, t, true);
    const theta = this.leaderThetaAt(f, t);

    // forward tangent along travel path; lateral is normal to path.
    const vx = Math.sin(theta) * f.rx;
    const vy = -Math.cos(theta) * f.ry;
    const speed = Math.hypot(vx, vy) || 1;
    const fx = vx / speed;
    const fy = vy / speed;
    const lx = -fy;
    const ly = fx;

    const s = f.scale;
    const isGold = f.family === "gold";
    const tilePalette = isGold ? GOLD_TILES : BLUE_TILES;
    const glyphColor = isGold ? GOLD_GLYPH : BLUE_GLYPH;

    const flap = Math.sin(t * 1.6 + f.phase);
    const wag = Math.sin(t * 2.2 + f.phase) * 0.25;

    // sparkle: one cell turns lavender near the cycle midpoint.
    const windowIndex = Math.floor(t / f.sparklePeriod);
    const inWindow = (t % f.sparklePeriod) < 0.28;
    const sparkleSlot = inWindow
      ? Math.floor(hash01(f.id * 991 + 37, windowIndex * 17) * 28)
      : -1;

    const headGx = Math.round(center.x / CELL);
    const headGy = Math.round(center.y / CELL);

    const box = Math.max(3, Math.ceil(5.5 * s));
    let slot = 0;
    const occupied = new Set<string>();

    for (let dy = -box; dy <= box; dy++) {
      for (let dx = -box; dx <= box; dx++) {
        const u = (dx * fx + dy * fy) / s;
        const v = Math.abs(dx * lx + dy * ly) / s;

        let isBody = false;

        // cephalic horns at front of ray.
        if (u >= 1.2 && u <= 1.95 && v >= 0.35 && v <= 1.15) {
          isBody = true;
        } else if (u >= -2.4 && u < 1.2) {
          // main body and broad wings.
          if (v <= 0.85) {
            isBody = true;
          } else if (u >= -0.2) {
            const edge = 0.85 + (1.2 - u) * 1.8;
            if (v <= edge) isBody = true;
          } else {
            const taper = Math.pow((u - (-2.4)) / 2.2, 0.85);
            const edge = 0.85 + 2.7 * (1.0 + flap * 0.18) * taper;
            if (v <= edge) isBody = true;
          }
        } else if (u >= -3.6 && u < -2.4) {
          // slender tail at rear.
          const lateralOffset = (dx * lx + dy * ly) / s;
          if (Math.abs(lateralOffset - wag) <= 0.55) {
            isBody = true;
          }
        }

        const gx = headGx + dx;
        const gy = headGy + dy;
        const key = `${gx},${gy}`;

        if (isBody) {
          occupied.add(key);
          const sparkle = slot === sparkleSlot;
          const nuance = tilePalette[Math.floor(hash01(f.id * 89 + slot, 31) * tilePalette.length)];
          const tile = sparkle ? SPARKLE_TILE : nuance;
          const glyph = sparkle ? SPARKLE_GLYPH : glyphColor;

          this.pushCell(
            gx * CELL,
            gy * CELL,
            this.pickGlyph(f.id * 131 + slot, t),
            glyph,
            tile,
            1.0,
            "body",
          );
          slot++;
        } else if (v > 1.2 && v < 3.8 && u > -2.2 && u < 1.0) {
          // occasional fringe glyph at wing edge without tile.
          if (hash01(f.id * 57 + dx * 13 + dy, Math.floor(t * 2)) < 0.28) {
            occupied.add(key);
            this.pushCell(
              gx * CELL,
              gy * CELL,
              this.pickWakeGlyph(f.id * 211 + slot, t),
              WAKE_GLYPH_COLOR,
              "",
              0.55,
              "fringe",
            );
            slot++;
          }
        }
      }
    }

    // emit wake trail along past path.
    if (f.kind !== "small") {
      for (let i = 1; i <= WAKE_STEPS; i++) {
        const age = i * WAKE_STEP_SECONDS;
        const past = this.positionAt(f, t - age, true);
        const pastTheta = this.leaderThetaAt(f, t - age);
        const pvx = Math.sin(pastTheta) * f.rx;
        const pvy = -Math.cos(pastTheta) * f.ry;
        const pSpeed = Math.hypot(pvx, pvy) || 1;
        const pfx = pvx / pSpeed;
        const pfy = pvy / pSpeed;

        const tailX = past.x - pfx * (3.0 * s * CELL);
        const tailY = past.y - pfy * (3.0 * s * CELL);
        const wgx = Math.round(tailX / CELL);
        const wgy = Math.round(tailY / CELL);
        const wkey = `${wgx},${wgy}`;

        if (!occupied.has(wkey)) {
          occupied.add(wkey);
          const trail = i / WAKE_STEPS;
          this.pushCell(
            wgx * CELL,
            wgy * CELL,
            this.pickWakeGlyph(f.id * 611 + i, t),
            WAKE_GLYPH_COLOR,
            "",
            0,
            0.65 * (1 - trail),
            "wake",
          );
        }
      }
    }
  }

  private emitBlurFish(f: Fish, t: number): void {
    const center = this.positionAt(f, t, true);
    const theta = this.thetaAt(f, t);
    const vx = Math.sin(theta) * f.rx;
    const vy = -Math.cos(theta) * f.ry;
    const speed = Math.hypot(vx, vy) || 1;
    const fx = vx / speed;
    const fy = vy / speed;
    const lx = -fy;
    const ly = fx;

    const s = f.scale;
    const box = Math.max(3, Math.ceil(4.0 * s));
    const headGx = Math.round(center.x / CELL);
    const headGy = Math.round(center.y / CELL);

    for (let dy = -box; dy <= box; dy += 2) {
      for (let dx = -box; dx <= box; dx += 2) {
        const u = (dx * fx + dy * fy) / s;
        const v = Math.abs(dx * lx + dy * ly) / s;
        if (u >= -2.0 && u <= 1.2 && v <= 1.8) {
          const px = (headGx + dx) * CELL;
          const py = (headGy + dy) * CELL;
          this.pushBlurCell(px, py, BLUR_COLOR);
        }
      }
    }
  }

  private pushCell(
    x: number,
    y: number,
    glyph: string,
    glyphColor: string,
    tileColor: string,
    tileAlpha: number,
    alpha: number,
    kind: CellKind,
  ): void {
    if (this.cellCount >= this.cells.length) return;
    const c = this.cells[this.cellCount];
    c.x = x;
    c.y = y;
    c.glyph = glyph;
    c.glyphColor = glyphColor;
    c.tileColor = tileColor;
    c.alpha = alpha;
    c.kind = kind;
    this.cellCount++;
  }

  private pushBlurCell(x: number, y: number, color: string): void {
    if (this.blurCellCount >= this.blurCells.length) return;
    const c = this.blurCells[this.blurCellCount];
    c.x = x;
    c.y = y;
    c.glyph = " ";
    c.glyphColor = "#000000";
    c.tileColor = color;
    c.alpha = 0.55;
    c.kind = "body";
    this.blurCellCount++;
  }

  /** pick a body glyph that re-rolls at about 3 hz. */
  private pickGlyph(seed: number, t: number): string {
    const hold = hash01(seed + 7, Math.floor(t * 1.5)) < 0.4;
    const step = hold ? Math.floor(t * 1.5) : Math.floor(t * 3.5);
    return BODY_GLYPHS[Math.floor(hash01(seed, step) * BODY_GLYPHS.length)];
  }

  private pickWakeGlyph(seed: number, t: number): string {
    return WAKE_GLYPHS[Math.floor(hash01(seed, Math.floor(t * 2)) * WAKE_GLYPHS.length)];
  }
}
