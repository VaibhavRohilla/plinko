import { outcomes } from "./outcomes";

// Convert the new outcomes format into per-rows arrays of slot offsets.
// New format (example):
// outcomes = { "16": { "0": [..], "1": [..], ..., "16": [..] } }
// We convert it to: { 16: [ [...], [...], ... ] } as number[][].
function toOffsetsByRows(): Record<number, number[][]> {
  const result: Record<number, number[][]> = {};
  for (const rowsKey of Object.keys(outcomes)) {
    const rows = Number(rowsKey);
    const byIndexObj = (outcomes as Record<string, Record<string, number[]>>)[rowsKey];
    const indexKeys = Object.keys(byIndexObj).map((k) => Number(k)).sort((a, b) => a - b);
    const arr: number[][] = [];
    for (const i of indexKeys) {
      const offsets = byIndexObj[String(i)] || [];
      arr[i] = offsets.slice(); // already slot offsets (center-based units)
    }
    result[rows] = arr;
  }
  return result;
}

// Build from provided outcomes; additional rows can be added similarly
export const outcomesByRows: Record<number, number[][]> = toOffsetsByRows();
