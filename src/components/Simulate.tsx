import { useEffect, useRef, useState } from "react";

import { BallManager } from "../game/classes/BallManager";
import { pad } from "../game/padding";
import { WIDTH } from "../game/constants";

export const Simulate = () => {
  const canvasRef = useRef<any>(null);
  //   let [outputs, setOutputs] = useState<{ [key: number]: number[] }>({
  let [outputs, setOutputs] = useState<any>({
    0: [],
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
    7: [],
    8: [],
    9: [],
    10: [],
    11: [],
    12: [],
    13: [],
    14: [],
    15: [],
    16: [],
    17: [],
  });

  async function simulate(ballManager: BallManager) {
    let i = 0;
    while (1) {
      i++;
      // Start exactly at the canvas center
      ballManager.addBall(pad(WIDTH / 2));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  useEffect(() => {
    if (canvasRef.current) {
      const ballManager = new BallManager(
        canvasRef.current as unknown as HTMLCanvasElement,
        (index: number, _startX?: number) => {
          // Only register confirmed bin hits (onFinish callback)
          if (typeof index !== 'number' || index < 0) return;
          setOutputs((outputs: any) => {
            return {
              ...outputs,
              // push a simple hit marker (1); length = total hits for this bin
              [index]: [...(outputs[index] as number[]), 1],
            };
          });
        }
      );
      simulate(ballManager);

      return () => {
        ballManager.stop();
      };
    }
  }, [canvasRef]);

  return (
    <div className="flex flex-col items-center justify-center">
      <canvas ref={canvasRef} width="800" height="800"></canvas>
    </div>
  );
};
