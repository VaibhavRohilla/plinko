import { HEIGHT, WIDTH } from "./constants";
import { pad } from "./padding";

export interface Obstacle {
  x: number;
  y: number;
  radius: number;
  glow?: number;
}

export interface Sink {
  x: number;
  y: number;
  width: number;
  height: number;
  multiplier?: number;
  // runtime animation state (optional)
  press?: number; // 0..1 press amount, decays to 0
  glow?: number;  // 0..1 glow amount, decays to 0
}

function getMultiplier(indexZeroBased: number, numSinks: number): number {
  const i = indexZeroBased;
  const center = (numSinks - 1) / 2;
  const d = Math.abs(i - center);
  const maxD = center;
  const edge = 16;
  const mid = 1;
  const centerMin = 0.5; // minimum at center
  // Interpolate from centerMin at center to edge at edges, with a slight bump around mid
  const linear = centerMin + (edge - centerMin) * (d / Math.max(1, maxD));
  // Slight mid bump
  const midBump = mid + (1 - Math.abs(d - maxD / 2) / (maxD / 2 + 0.0001)) * 0.2;
  return Number((linear * midBump).toFixed(2));
}

export function createObstacles(rows: number, obstacleRadiusPx: number): Obstacle[] {
  // "rows" represents the number of peg rows, starting with 3 pegs at the top.
  // Bottom row will therefore have rows + 2 pegs (e.g., rows=8 -> bottom=10 pegs).
  const obstacles: Obstacle[] = [];
  const verticalGap = (HEIGHT - 220) / rows; // keep bottom space for sinks
  // Maintain a safe margin so outer pegs don't clip the canvas
  const horizontalPad = Math.max(obstacleRadiusPx * 2, 12);
  const safeWidth = WIDTH - 2 * horizontalPad;
  // Base spacing determined by the bottom row (rows+2 pegs → rows+1 gaps)
  const baseSpacing = safeWidth / (rows + 1);

  for (let level = 0; level < rows; level++) {
    const numObstacles = level + 3; // top=3, increases by 1 per level
    const y = (level + 1) * verticalGap;
    // center each row; width grows with numObstacles to form a triangle
    const rowWidth = baseSpacing * (numObstacles - 1);
    const rowStart = WIDTH / 2 - rowWidth / 2;
    for (let col = 0; col < numObstacles; col++) {
      const x = rowStart + baseSpacing * col;
      // Clamp to keep within safe area in edge cases
      const clampedX = Math.max(horizontalPad, Math.min(WIDTH - horizontalPad, x));
      obstacles.push({ x: pad(clampedX), y: pad(y), radius: obstacleRadiusPx });
    }
  }
  return obstacles;
}

export function createSinks(numSinks: number, sinkWidthPx: number): Sink[] {
  const sinks: Sink[] = [];
  // Keep bin centers within a safe margin; sink.x is the LEFT coordinate used by renderer
  const edgePad = Math.max(12, Math.ceil(sinkWidthPx / 2 + 2));
  const spacing = (WIDTH - 2 * edgePad) / Math.max(1, (numSinks - 1));
  for (let i = 0; i < numSinks; i++) {
    const centerX = edgePad + spacing * i;
    const x = centerX - sinkWidthPx / 2;
    const y = HEIGHT - 170; // will be re-positioned precisely in BallManager
    const width = sinkWidthPx;
    const height = width;
    sinks.push({ x, y, width, height, multiplier: getMultiplier(i, numSinks) });
  }
  return sinks;
}
