// the ascii fish school for the knowledge inbox background.
// pure typescript: no dom, no renderer. the sim is a pure function of
// the wall clock, so the school is correct at any render cadence.

/** one grid cell, in css pixels. the renderer snaps it to the 14px grid. */
export const CELL = 14;

const BODY_GLYPHS = ["%", "8", "#", "X", "@", "S"];
const WAKE_GLYPHS = ["t", "o", ":", ";", ".", "'"];

const GOLD_TILE = "#6d6559";
const GOLD_GLYPH = "#d3c8bb";
const BLUE_TILE = "#4d5065";
const BLUE_GLYPH = "#c1c4d9";
const SPARKLE_GLYPH = "#9aa0f0";
const FRINGE_COLOR = "#c8c8d2";

const BLUR_PEAK = "#54545e";
const BLUR_MID = "#252530";

/** profiles decoded from the reference crops: row widths, head first. */
const PROFILES: Record<FishKind, number[][]> = {
  large: [
    [2, 4, 6, 8, 8, 6, 2],
    [5, 6, 7, 6, 6, 3],
    [2, 3, 4, 5, 5, 6, 5, 3],
  ],
  medium: [
    [2, 4, 6, 6, 4, 2],
    [3, 5, 5, 3],
    [2, 3, 4, 5, 4, 3],
  ],
  small: [
    [3, 2, 3],
    [2, 3, 2],
    [3, 3],
  ],
};

const SMALL_COUNT = 8;

const OMEGA = 0.055;
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
  profile: number[];
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

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255;
  const ag = (pa >> 8) & 255;
  const ab = pa & 255;
  const br = (pb >> 16) & 255;
  const bg = (pb >> 8) & 255;
  const bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, "0")}`;
}

/**
 * the fish school. positions are a function of the wall clock,
 * so any render rate paints the correct frame.
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

  /** position on the ellipse, with the radial sway when requested. */
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
    // pre-warm placement from the reference first frame:
    // large gold near top-centre and right edge, large blue bottom-centre.
    const starts: { kind: FishKind; family: "gold" | "blue"; theta: number }[] = [
      { kind: "large", family: "gold", theta: (3 * Math.PI) / 2 + 0.25 },
      { kind: "large", family: "gold", theta: 0.15 },
      { kind: "large", family: "gold", theta: -0.3 },
      { kind: "large", family: "blue", theta: Math.PI / 2 - 0.35 },
      { kind: "large", family: "gold", theta: Math.PI + 0.45 },
      { kind: "large", family: "blue", theta: Math.PI - 0.6 },
      { kind: "medium", family: "blue", theta: (3 * Math.PI) / 2 - 0.9 },
      { kind: "medium", family: "gold", theta: Math.PI / 2 + 1.1 },
      { kind: "medium", family: "blue", theta: 0.9 },
      { kind: "medium", family: "gold", theta: Math.PI + 1.4 },
    ];
    const rx = 0.46 * this.width;
    const ry = 0.43 * this.height;
    this.fish = starts.map((s, i) => this.makeFish(i, s.kind, s.family, s.theta, rx, ry));

    // small fry follow a large fish at a 1 to 3 cell lag.
    const largeIds = this.fish.filter((f) => f.kind === "large").map((f) => f.id);
    for (let i = 0; i < SMALL_COUNT; i++) {
      const leader = largeIds[i % largeIds.length];
      const f = this.makeFish(
        starts.length + i,
        "small",
        this.rand() < 0.55 ? "gold" : "blue",
        Math.random() * Math.PI * 2,
        rx,
        ry,
      );
      f.leaderId = leader;
      f.lag = 0.025 + this.rand() * 0.05;
      f.omega *= 0.9 + this.rand() * 0.2;
      this.fish.push(f);
    }
  }

  private buildBlurFish(): void {
    const rx = 0.46 * this.width;
    const ry = 0.43 * this.height;
    // near the camera on the left edge: one high, two low.
    const thetas = [Math.PI - 0.7, Math.PI + 0.5, Math.PI - 0.1];
    this.blurFish = thetas.map((theta, i) =>
      this.makeFish(i, "large", i === 1 ? "blue" : "gold", theta, rx, ry),
    );
  }

  private makeFish(
    id: number,
    kind: FishKind,
    family: "gold" | "blue",
    theta: number,
    rx: number,
    ry: number,
  ): Fish {
    const profiles = PROFILES[kind];
    const jitter = 0.92 + this.rand() * 0.16;
    return {
      id,
      kind,
      family,
      theta0: theta,
      omega: OMEGA * (0.85 + this.rand() * 0.3),
      rx: rx * jitter,
      ry: ry * jitter,
      profile: profiles[Math.floor(this.rand() * profiles.length)],
      phase: this.rand() * Math.PI * 2,
      sparklePeriod: 2.0 + this.rand() * 1.5,
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

  /** paint the school at time t (seconds). pure in t; dt is not needed. */
  update(t: number): void {
    this.ensurePool();
    this.cellCount = 0;
    this.blurCellCount = 0;

    for (const f of this.fish) this.emitFish(f, t);
    for (const f of this.blurFish) this.emitBlurFish(f, t);
  }

  private bodyCellCount(f: Fish): number {
    return f.profile.reduce((sum, w) => sum + w, 0);
  }

  private emitFish(f: Fish, t: number): void {
    const head = this.positionAt(f, t, true);
    const theta = this.leaderThetaAt(f, t);
    const vx = Math.sin(theta) * f.rx;
    const vy = -Math.cos(theta) * f.ry;
    const speed = Math.hypot(vx, vy) || 1;
    // forward points along the travel direction; body rows run backwards.
    const fx = vx / speed;
    const fy = vy / speed;
    const lx = -fy;
    const ly = fx;

    const isGold = f.family === "gold";
    const tile = isGold ? GOLD_TILE : BLUE_TILE;
    const glyph = isGold ? GOLD_GLYPH : BLUE_GLYPH;
    const bodyTileScale = f.kind === "small" ? 0.75 : 1;
    const flex = Math.sin(t * 0.6 + f.phase) < -0.5;

    // sparkle: one cell flashes lavender near the middle of each cycle.
    const window_ = Math.floor(t / f.sparklePeriod);
    const inWindow = (t % f.sparklePeriod) < 0.25;
    const sparkleSlot = inWindow
      ? Math.floor(hash01(f.id * 991 + 37, window_ * 17) * this.bodyCellCount(f))
      : -1;

    let slot = 0;
    for (let row = 0; row < f.profile.length; row++) {
      let width = f.profile[row];
      // the trailing rows flex on/off with the undulation.
      if (flex && row >= f.profile.length - 2 && width > 1) width -= 1;
      const back = row * CELL;
      const center = (width - 1) / 2;
      for (let col = 0; col < width; col++) {
        const px = head.x - fx * back + lx * (col - center) * CELL;
        const py = head.y - fy * back + ly * (col - center) * CELL;
        const edge = row === 0 || row === f.profile.length - 1 || col === 0 || col === width - 1;
        const jitter = 0.85 + hash01(f.id * 97 + row, Math.floor(t * 4) * 31 + col) * 0.3;
        const tileAlpha = (0.9 * jitter - (edge ? 0.1 : 0)) * bodyTileScale;
        const sparkle = slot === sparkleSlot;
        this.pushCell(
          Math.round(px / CELL) * CELL,
          Math.round(py / CELL) * CELL,
          this.pickGlyph(f.id * 131 + slot, t),
          sparkle ? SPARKLE_GLYPH : glyph,
          tile,
          Math.min(1, tileAlpha),
          sparkle ? 1 : 0.7 + jitter * 0.3 * hash01(slot, Math.floor(t * 4)),
          "body",
        );
        slot++;
      }
      // one fringe glyph past each row end, no tile.
      for (const side of [-1, 1]) {
        if (hash01(f.id * 57 + row, Math.floor(t * 2)) < 0.35) {
          const fx2 = head.x - fx * back + lx * (center + side * (width + 1) / 2) * CELL;
          const fy2 = head.y - fy * back + ly * (center + side * (width + 1) / 2) * CELL;
          this.pushCell(
            Math.round(fx2 / CELL) * CELL,
            Math.round(fy2 / CELL) * CELL,
            this.pickWakeGlyph(f.id * 211 + row, t),
            FRINGE_COLOR,
            "",
            0,
            0.6,
            "fringe",
          );
        }
      }
    }

    // the tail: attached to the body and wags with the sway. without it
    // the shape reads as a blob instead of a fish.
    const tailRows = f.kind === "small" ? [1] : [2, 1];
    for (let r = 0; r < tailRows.length; r++) {
      const width = tailRows[r];
      const back = (f.profile.length + r) * CELL;
      const wag = Math.sin(t * 1.2 + f.phase) * 1.6;
      const center = (width - 1) / 2;
      for (let col = 0; col < width; col++) {
        const px = head.x - fx * back + lx * ((col - center) + wag) * CELL;
        const py = head.y - fy * back + ly * ((col - center) + wag) * CELL;
        const sparkle = slot === sparkleSlot;
        this.pushCell(
          Math.round(px / CELL) * CELL,
          Math.round(py / CELL) * CELL,
          this.pickGlyph(f.id * 131 + slot, t),
          sparkle ? SPARKLE_GLYPH : glyph,
          tile,
          sparkle ? 0.8 : Math.max(0.55, bodyTileScale * 0.72),
          sparkle ? 1 : 0.75,
          "body",
        );
        slot++;
      }
    }

    this.emitWake(f, t);
  }

  private emitWake(f: Fish, t: number): void {
    if (f.kind === "small") return;
    for (let i = 1; i <= WAKE_STEPS; i++) {
      const age = i * WAKE_STEP_SECONDS;
      const p = this.positionAt(f, t - age, true);
      const trail = i / WAKE_STEPS;
      const prob = 0.7 * (1 - trail);
      if (hash01(f.id * 313 + i, Math.floor(t * 4)) >= prob) continue;
      const jx = (hash01(f.id * 417 + i, Math.floor(t * 2)) - 0.5) * 1.6 * CELL;
      const jy = (hash01(f.id * 521 + i, Math.floor(t * 2) + 7) - 0.5) * 1.6 * CELL;
      this.pushCell(
        Math.round((p.x + jx) / CELL) * CELL,
        Math.round((p.y + jy) / CELL) * CELL,
        this.pickWakeGlyph(f.id * 611 + i, t),
        FRINGE_COLOR,
        "",
        0,
        0.6 * (1 - trail),
        "wake",
      );
    }
  }

  private emitBlurFish(f: Fish, t: number): void {
    const head = this.positionAt(f, t, true);
    const theta = this.thetaAt(f, t);
    const vx = Math.sin(theta) * f.rx;
    const vy = -Math.cos(theta) * f.ry;
    const speed = Math.hypot(vx, vy) || 1;
    const fx = vx / speed;
    const fy = vy / speed;
    const lx = -fy;
    const ly = fx;

    // out-of-focus bodies read about 1.35 times larger than sharp ones.
    const scale = 1.35;
    let slot = 0;
    for (let row = 0; row < f.profile.length; row++) {
      const width = f.profile[row];
      const back = row * CELL * scale;
      const center = (width - 1) / 2;
      for (let col = 0; col < width; col++) {
        const px = head.x - fx * back + lx * (col - center) * CELL * scale;
        const py = head.y - fy * back + ly * (col - center) * CELL * scale;
        const depth = 1 - row / f.profile.length;
        const cellColor = mixHex(BLUR_MID, BLUR_PEAK, 0.35 + hash01(slot, row) * 0.65 * depth);
        this.pushBlurCell(px, py, cellColor);
        slot++;
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
    const c = this.cells[this.cellCount];
    c.x = x;
    c.y = y;
    c.glyph = glyph;
    c.glyphColor = glyphColor;
    c.alpha = alpha;
    c.kind = kind;
    if (kind !== "body") {
      // fringe and wake glyphs draw without a tile.
      c.tileColor = "";
    } else {
      // the renderer composes the tile over the dark app background,
      // so the tile alpha is baked into its color instead.
      c.tileColor = tileAlpha > 0 ? mixHex("#0a0b10", tileColor, Math.min(1, tileAlpha)) : "";
    }
    this.cellCount++;
  }

  private pushBlurCell(x: number, y: number, color: string): void {
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

  /** body glyph that re-rolls at about 4 hz; 30 percent of cells hold a second. */
  private pickGlyph(seed: number, t: number): string {
    const bucket = hash01(seed + 7, Math.floor(t * 1)) < 0.3 ? Math.floor(t) : Math.floor(t * 4);
    return BODY_GLYPHS[Math.floor(hash01(seed, bucket) * BODY_GLYPHS.length)];
  }

  private pickWakeGlyph(seed: number, t: number): string {
    return WAKE_GLYPHS[Math.floor(hash01(seed, Math.floor(t * 4)) * WAKE_GLYPHS.length)];
  }
}
