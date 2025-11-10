import { useEffect, useRef, useState } from "react";
import { BallManager } from "../game/classes/BallManager";
import { WIDTH, HEIGHT } from "../game/constants";
import { pad } from "../game/padding";

type Outputs = { [binIndex: number]: number[] };

export function Calibrate() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rows, setRows] = useState<number>(16);
  const [slotsHalfRange, setSlotsHalfRange] = useState<number>(10);
  const [drops, setDrops] = useState<number>(500);
  const [outputs, setOutputs] = useState<Outputs>({});
  const [running, setRunning] = useState<boolean>(false);
  const [sinksCount, setSinksCount] = useState<number>(0);
  const bmRef = useRef<BallManager | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const bm = new BallManager(
      canvasRef.current,
      (index: number, startX?: number) => {
        if (startX === undefined) return;
        setOutputs((prev) => {
          const next = { ...prev } as Outputs;
          next[index] = [...(next[index] || []), startX];
          return next;
        });
      },
      { rows }
    );
    setSinksCount(bm.getNumSinks());
    bmRef.current = bm;
    return () => bm.stop();
  }, [canvasRef, rows]);

  const runSweep = async () => {
    if (!canvasRef.current) return;
    setOutputs({});
    setRunning(true);
    const bm = new BallManager(canvasRef.current, (index: number, startX?: number) => {
      if (startX === undefined) return;
      setOutputs((prev) => {
        const next = { ...prev } as Outputs;
        next[index] = [...(next[index] || []), startX];
        return next;
      });
    }, { rows });
    bmRef.current = bm;

    // Drop balls uniformly over [-slotsHalfRange, +slotsHalfRange] using TRUE spacing mapping
    for (let i = 0; i < drops; i++) {
      const r = (Math.random() * 2 - 1) * slotsHalfRange;
      const startX = bm.getStartXPaddedForOffset(r);
      bm.addBall(startX);
      // let each ball land
      // eslint-disable-next-line no-await-in-loop
      await new Promise((res) => setTimeout(res, 900));
    }
    setRunning(false);
  };

  // Build normalized JSON to paste into outcomesByRows
  const normalized: { [k: number]: number[] } = {};
  const spacing = bmRef.current?.getBottomRowCenterSpacingPx() ?? (WIDTH / Math.max(1, sinksCount));
  for (const k of Object.keys(outputs)) {
    const idx = Number(k);
    const arr = outputs[idx] || [];
    if (arr.length === 0) continue;
    const offsets = arr.map((paddedPx) => (paddedPx / 10000 - WIDTH / 2) / spacing);
    normalized[idx] = offsets;
  }

  const jsonBlob = JSON.stringify({ [rows]: normalized }, null, 2);

  return (
    <div className="flex flex-col lg:flex-row  items-center justify-between h-screen p-6 gap-6">
      <div className="flex flex-col gap-3 w-full lg:w-1/3">
        <div className="flex items-center gap-2">
          <label className="w-24">Rows</label>
          <input
            type="number"
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1 text-white"
            value={rows}
            min={8}
            max={16}
            onChange={(e) => setRows(Math.min(16, Math.max(8, parseInt(e.target.value || "18", 10))))}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="w-24">Sweep half-range (slots)</label>
          <input
            type="number"
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1 text-white"
            value={slotsHalfRange}
            min={4}
            max={20}
            onChange={(e) => setSlotsHalfRange(Math.min(20, Math.max(4, parseInt(e.target.value || "10", 10))))}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="w-24">Drops</label>
          <input
            type="number"
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1 text-white"
            value={drops}
            min={1}
            max={2000}
            onChange={(e) => setDrops(Math.min(2000, Math.max(1, parseInt(e.target.value || "500", 10))))}
          />
        </div>

        <button
          type="button"
          disabled={running}
          className="bg-purple-600 disabled:bg-gray-700 text-white rounded px-4 py-2"
          onClick={runSweep}
        >
          {running ? "Calibrating..." : "Run Sweep"}
        </button>

        <div className="text-sm text-gray-400">Sinks: {sinksCount}</div>
        <div className="text-xs text-gray-400">Collected: {Object.values(outputs).reduce((a, b) => a + b.length, 0)}</div>
      </div>

      <div className="flex flex-col items-stretch gap-4 w-full lg:w-2/3">
        <div className="bg-gray-900 border border-gray-800 rounded p-3 text-xs overflow-auto max-h-80">
          <pre className="whitespace-pre-wrap break-all">{jsonBlob}</pre>
        </div>
        <div className="flex justify-center">
          <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
        </div>
      </div>
    </div>
  );
}


