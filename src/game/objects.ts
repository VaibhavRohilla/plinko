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
  const obstacles: Obstacle[] = [];
  const verticalGap = (HEIGHT - 220) / rows; // keep bottom space for sinks
  const baseSpacing = WIDTH / (rows + 2); // horizontal spacing adapts to rows
  for (let row = 2; row < rows; row++) {
    const numObstacles = row + 1;
    const y = row * verticalGap;
    const spacing = baseSpacing;
    for (let col = 0; col < numObstacles; col++) {
      const x = WIDTH / 2 - spacing * (row / 2 - col);
      obstacles.push({ x: pad(x), y: pad(y), radius: obstacleRadiusPx });
    }
  }
  return obstacles;
}

export function createSinks(numSinks: number, sinkWidthPx: number, obstacleRadiusPx: number): Sink[] {
  const sinks: Sink[] = [];
  const spacingPad = obstacleRadiusPx * 2;
  for (let i = 0; i < numSinks; i++) {
    const x = WIDTH / 2 + sinkWidthPx * (i - Math.floor(numSinks / 2)) - spacingPad * 1.5;
    const y = HEIGHT - 170;
    const width = sinkWidthPx;
    const height = width;
    sinks.push({ x, y, width, height, multiplier: getMultiplier(i, numSinks) });
  }
  return sinks;
}
