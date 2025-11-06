import { WIDTH, sinkWidth } from "./constants";
import { outcomes } from "./outcomes";
import { unpad } from "./padding";

// Convert legacy pixel-based outcomes (padded px) into normalized slot offsets for rows=16
function legacyToOffsets(): number[][] {
  const keys = Object.keys(outcomes).map((k) => Number(k)).sort((a, b) => a - b);
  const byIndex: number[][] = [];
  for (const k of keys) {
    const arr = (outcomes as Record<string, number[]>)![String(k)] as number[] | undefined;
    if (!arr || arr.length === 0) {
      byIndex[k] = [];
      continue;
    }
    const offsets = arr.map((paddedPx) => {
      const px = unpad(paddedPx);
      return (px - WIDTH / 2) / sinkWidth; // slot units relative to center
    });
    byIndex[k] = offsets;
  }
  return byIndex;
}

// Seed with transformed legacy data for 16 rows; add more rows via calibration
export const outcomesByRows: Record<number, number[][]> = {
  18: legacyToOffsets(),
  // Pre-populate common rows; fill with calibration JSON later
  8: [],
  12: [],
  16: [],
  20: [],
};


