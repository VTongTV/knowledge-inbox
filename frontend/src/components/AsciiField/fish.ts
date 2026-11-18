// the ascii fish school for the knowledge inbox background.
// all positions use the wall clock as an input.

/** one grid cell in pixels. the renderer snaps it to the 14px grid. */
export const CELL = 14;

export const BODY_GLYPHS = ["%", "8", "#", "X", "@", "S"];
export const WAKE_GLYPHS = ["t", "o", ":", ";", ".", "'", ","];

const GOLD_TILES = ["#635442", "#6c5c48", "#75644e", "#7e6c54", "#87745b"];
const GOLD_GLYPH = "#eee5d7";

const BLUE_TILES = ["#383f58", "#3f4763", "#464f6e", "#4d577a", "#545f85"];
const BLUE_GLYPH = "#e2e6fa";

const SPARKLE_TILE = "#68588c";
const SPARKLE_GLYPH = "#dcc4ff";

const WAKE_GLYPH_COLOR = "#8c90a4";

const OMEGA = 0.082;
const WAKE_STEPS = 14;
const WAKE_STEP_SECONDS = 0.12;

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
  lateralOffset: number;
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
  /** the out-of-focus fish, drawn on a lower layer. */
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

  /** angle on the ellipse at time t. grows by omega per second. */
  private thetaAt(f: Fish, t: number): number {
    return f.theta0 - f.omega * t;
  }

  /** angle for small fish. the fish tails the leader with a lag. */
  private leaderThetaAt(f: Fish, t: number): number {
    if (f.leaderId < 0) return this.thetaAt(f, t);
    const leader = this.fish.find((o) => o.id === f.leaderId);
    if (!leader) return this.thetaAt(f, t);
    return this.thetaAt(leader, t) + f.lag + Math.sin(t * 0.8 + f.phase) * 0.02;
  }

  /** position on the ellipse with radial sway and lateral drift. */
  private positionAt(f: Fish, t: number, sway: boolean): { x: number; y: number } {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const theta = this.leaderThetaAt(f, t);
    const s = sway ? Math.sin(t * 1.4 + f.phase) * 16 : 0;
    const vx = Math.sin(theta);
    const vy = -Math.cos(theta);
    const lx = -vy;
    const ly = vx;
    const lat = (f.lateralOffset ? f.lateralOffset * CELL : 0) + (sway ? Math.cos(t * 1.0 + f.phase) * 9 : 0);
    return {
      x: cx + f.rx * Math.cos(theta) + vx * s + lx * lat,
      y: cy + f.ry * Math.sin(theta) + vy * s + ly * lat,
    };
  }

  private buildFish(): void {
    const starts: { kind: FishKind; family: "gold" | "blue"; theta: number; scale: number }[] = [
      { kind: "large", family: "gold", theta: (3 * Math.PI) / 2 + 0.15, scale: 1.35 },
      { kind: "large", family: "blue", theta: (7 * Math.PI) / 4 + 0.2, scale: 1.3 },
      { kind: "large", family: "gold", theta: 0.15, scale: 1.35 },
      { kind: "large", family: "blue", theta: Math.PI / 2 - 0.2, scale: 1.3 },
      { kind: "medium", family: "gold", theta: (3 * Math.PI) / 4 + 0.1, scale: 1.0 },
      { kind: "medium", family: "blue", theta: Math.PI - 0.35, scale: 1.0 },
      { kind: "medium", family: "gold", theta: (3 * Math.PI) / 2 - 0.75, scale: 0.95 },
    ];
    const rx = 0.44 * this.width;
    const ry = 0.41 * this.height;
    this.fish = starts.map((s, i) => this.makeFish(i, s.kind, s.family, s.theta, rx, ry, s.scale));

    const largeFish = this.fish.filter((f) => f.kind === "large");
    for (let i = 0; i < 4; i++) {
      const leader = largeFish[i % largeFish.length];
      const side = i % 2 === 0 ? 1 : -1;
      const f = this.makeFish(
        starts.length + i,
        "small",
        leader.family,
        0,
        rx,
        ry,
        0.7,
      );
      f.leaderId = leader.id;
      f.lag = 0.14 + this.rand() * 0.06;
      f.lateralOffset = side * (3.0 + this.rand() * 1.2);
      f.omega = leader.omega;
      this.fish.push(f);
    }
  }

  private buildBlurFish(): void {
    const rx = 0.45 * this.width;
    const ry = 0.42 * this.height;
    const starts: { family: "gold" | "blue"; theta: number; scale: number }[] = [
      { family: "blue", theta: Math.PI * 0.72, scale: 1.25 },
      { family: "gold", theta: Math.PI * 1.42, scale: 1.2 },
      { family: "blue", theta: -Math.PI * 0.12, scale: 1.3 },
    ];
    this.blurFish = starts.map((s, i) =>
      this.makeFish(i + 200, "large", s.family, s.theta, rx, ry, s.scale),
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
      omega: OMEGA * (0.92 + this.rand() * 0.16),
      rx: rx * jitter,
      ry: ry * jitter,
      scale,
      phase: this.rand() * Math.PI * 2,
      sparklePeriod: 1.4 + this.rand() * 1.0,
      leaderId: -1,
      lag: 0,
      lateralOffset: 0,
    };
  }

  private ensurePool(): void {
    while (this.cells.length < 3000) {
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
    while (this.blurCells.length < 1500) {
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

  /** verify if local coordinates (u, v) fall inside the knowledge inbox body. */
  private isBodyCell(u: number, v: number, flap: number, wag: number): boolean {
    if (u >= 1.0 && u <= 1.8 && v >= 0.4 && v <= 1.3) {
      return true;
    }
    if (u >= -2.2 && u < 1.0) {
      if (v <= 0.8) return true;
      if (u >= 0.0) {
        return v <= 0.8 + (1.0 - u) * 1.5;
      }
      const taper = Math.pow((u + 2.2) / 2.2, 0.85);
      return v <= 0.8 + 2.2 * (1.0 + flap * 0.35) * taper;
    }
    if (u >= -3.5 && u < -2.2) {
      return Math.abs(v - wag) <= 0.55;
    }
    return false;
  }

  /** verify if local coordinates (u, v) fall inside the fringe wake. */
  private isFringeCell(u: number, v: number, fishId: number, dx: number, dy: number, t: number): boolean {
    if (v <= 1.2 || v >= 3.2 || u <= -2.0 || u >= 0.8) return false;
    return hash01(fishId * 57 + dx * 13 + dy, Math.floor(t * 3.5)) < 0.32;
  }

  /** paint one fish at time t. */
  private emitFish(f: Fish, t: number): void {
    const center = this.positionAt(f, t, true);
    const theta = this.leaderThetaAt(f, t);

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

    const wag = Math.sin(t * 3.4 + f.phase) * 0.42;

    const windowIndex = Math.floor(t / f.sparklePeriod);
    const inWindow = (t % f.sparklePeriod) < 0.32;
    const sparkleSlot1 = inWindow
      ? Math.floor(hash01(f.id * 991 + 37, windowIndex * 17) * 24)
      : -1;
    const sparkleSlot2 = inWindow
      ? Math.floor(hash01(f.id * 533 + 71, windowIndex * 23) * 24)
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

        const gx = headGx + dx;
        const gy = headGy + dy;
        const key = `${gx},${gy}`;

        const wingPhase = t * 2.6 + f.phase - u * 0.35;
        const flap = Math.sin(wingPhase);

        if (this.isBodyCell(u, v, flap, wag)) {
          occupied.add(key);
          const sparkle = slot === sparkleSlot1 || slot === sparkleSlot2;
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
        } else if (this.isFringeCell(u, v, f.id, dx, dy, t)) {
          occupied.add(key);
          this.pushCell(
            gx * CELL,
            gy * CELL,
            this.pickWakeGlyph(f.id * 211 + slot, t),
            WAKE_GLYPH_COLOR,
            "",
            0.6,
            "fringe",
          );
          slot++;
        }
      }
    }

    this.emitWakeTrail(f, t, s, lx, ly, occupied);
  }

  /** emit wake glyphs along the past trajectory of the fish. */
  private emitWakeTrail(
    f: Fish,
    t: number,
    s: number,
    lx: number,
    ly: number,
    occupied: Set<string>,
  ): void {
    if (f.kind === "small") return;
    for (let i = 1; i <= WAKE_STEPS; i++) {
      const age = i * WAKE_STEP_SECONDS;
      const past = this.positionAt(f, t - age, true);
      const pastTheta = this.leaderThetaAt(f, t - age);
      const pvx = Math.sin(pastTheta) * f.rx;
      const pvy = -Math.cos(pastTheta) * f.ry;
      const pSpeed = Math.hypot(pvx, pvy) || 1;
      const pfx = pvx / pSpeed;
      const pfy = pvy / pSpeed;

      const trail = i / WAKE_STEPS;
      const serpentine = Math.sin(t * 3.6 + i * 0.5) * (trail * 0.6 * CELL);
      const tailX = past.x - pfx * (2.8 * s * CELL) + lx * serpentine;
      const tailY = past.y - pfy * (2.8 * s * CELL) + ly * serpentine;
      const wgx = Math.round(tailX / CELL);
      const wgy = Math.round(tailY / CELL);
      const wkey = `${wgx},${wgy}`;

      if (!occupied.has(wkey)) {
        occupied.add(wkey);
        this.pushCell(
          wgx * CELL,
          wgy * CELL,
          this.pickWakeGlyph(f.id * 611 + i, t),
          WAKE_GLYPH_COLOR,
          "",
          0.75 * (1 - trail),
          "wake",
        );
      }
    }
  }

  /** paint one out-of-focus background fish at time t. */
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
    const flap = Math.sin(t * 2.5 + f.phase);
    const wag = Math.sin(t * 3.3 + f.phase) * 0.35;

    const isGold = f.family === "gold";
    const baseColor = isGold ? "#3a3226" : "#2d354a";
    const spineColor = isGold ? "#4e4333" : "#3d4766";

    const box = Math.max(3, Math.ceil(5.5 * s));
    const headGx = Math.round(center.x / CELL);
    const headGy = Math.round(center.y / CELL);

    for (let dy = -box; dy <= box; dy++) {
      for (let dx = -box; dx <= box; dx++) {
        const u = (dx * fx + dy * fy) / s;
        const v = Math.abs(dx * lx + dy * ly) / s;
        if (this.isBodyCell(u, v, flap, wag)) {
          const px = (headGx + dx) * CELL;
          const py = (headGy + dy) * CELL;
          const color = v <= 0.8 ? spineColor : baseColor;
          this.pushBlurCell(px, py, color);
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
    c.alpha = 0.65;
    c.kind = "body";
    this.blurCellCount++;
  }

  /** pick a body glyph that updates at five hertz. */
  private pickGlyph(seed: number, t: number): string {
    const hold = hash01(seed + 7, Math.floor(t * 2.0)) < 0.35;
    const step = hold ? Math.floor(t * 2.0) : Math.floor(t * 5.0);
    return BODY_GLYPHS[Math.floor(hash01(seed, step) * BODY_GLYPHS.length)];
  }

  /** pick a wake glyph from the table. */
  private pickWakeGlyph(seed: number, t: number): string {
    return WAKE_GLYPHS[Math.floor(hash01(seed, Math.floor(t * 3)) * WAKE_GLYPHS.length)];
  }
}
