// tiny pixel-art "arrow" mark. a 5 wide by 7 tall grid of squares in gold
// and lavender. draws inline as svg rects.

interface PixelLogoProps {
  /** rendered edge length in css pixels. */
  size: number;
  title?: string;
}

const LAV = "#8f96e6";
const LAV_TOP = "#9aa0e8";
const GOLD = "#d9c89a";
const GOLD_DIM = "#8a7a52";

// row, columns filled in that row, colour per column.
// rows read top to bottom; columns index from 0 at the left edge.
const CELL = 3;
const GRID: { row: number; col: number; fill: string }[] = [
  { row: 0, col: 2, fill: LAV_TOP },
  { row: 1, col: 1, fill: LAV },
  { row: 1, col: 2, fill: GOLD },
  { row: 1, col: 3, fill: LAV },
  { row: 2, col: 0, fill: LAV },
  { row: 2, col: 1, fill: GOLD },
  { row: 2, col: 2, fill: GOLD },
  { row: 2, col: 3, fill: GOLD },
  { row: 2, col: 4, fill: LAV },
  { row: 3, col: 1, fill: GOLD },
  { row: 3, col: 2, fill: GOLD },
  { row: 3, col: 3, fill: GOLD },
  { row: 4, col: 2, fill: GOLD_DIM },
  { row: 5, col: 2, fill: GOLD_DIM },
];

export function PixelLogo({ size, title }: PixelLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${5 * CELL} ${6 * CELL}`}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {GRID.map((c) => (
        <rect key={`${c.row}-${c.col}`} x={c.col * CELL} y={c.row * CELL} width={CELL} height={CELL} fill={c.fill} />
      ))}
    </svg>
  );
}
