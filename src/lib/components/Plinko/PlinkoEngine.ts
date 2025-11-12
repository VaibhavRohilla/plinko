import { binPayouts } from '$lib/constants/game';
import {
  rowCount,
  winRecords,
  riskLevel,
  betAmount,
  balance,
  betAmountOfExistingBalls,
  totalProfitHistory,
} from '$lib/stores/game';
import type { RiskLevel, RowCount } from '$lib/types';
import { getRandomBetween } from '$lib/utils/numbers';
import Matter, { type IBodyDefinition } from 'matter-js';
import { get } from 'svelte/store';
import { v4 as uuidv4 } from 'uuid';

type BallFrictionsByRowCount = {
  friction: NonNullable<IBodyDefinition['friction']>;
  frictionAirByRowCount: Record<RowCount, NonNullable<IBodyDefinition['frictionAir']>>;
};

/**
 * Engine for rendering the Plinko game using [matter-js](https://brm.io/matter-js/).
 *
 * The engine will read/write data to Svelte stores during game state changes.
 */
class PlinkoEngine {
  /**
   * The canvas element to render the game to.
   */
  private canvas: HTMLCanvasElement;

  /**
   * A cache value of the {@link betAmount} store for faster access.
   */
  private betAmount: number;
  /**
   * A cache value of the {@link rowCount} store for faster access.
   */
  private rowCount: RowCount;
  /**
   * A cache value of the {@link riskLevel} store for faster access.
   */
  private riskLevel: RiskLevel;

  private engine: Matter.Engine;
  private render: Matter.Render;
  private runner: Matter.Runner;

  /**
   * Every pin of the game.
   */
  private pins: Matter.Body[] = [];
  /**
   * Walls are invisible, slanted "guard rails" at the left and right sides of the
   * pin triangle. It prevents balls from falling outside the pin triangle and not
   * hitting a bin.
   */
  private walls: Matter.Body[] = [];
  /**
   * "Sensor" is an invisible body at the bottom of the canvas. It detects whether
   * a ball arrives at the bottom and enters a bin.
   */
  private sensor: Matter.Body;

  /**
   * The x-coordinates of every pin's center in the last row. Useful for calculating
   * which bin a ball falls into.
   */
  private pinsLastRowXCoords: number[] = [];

  /**
   * The y-coordinates of each pin row center. Used to time when to steer the ball per row.
   */
  private rowYCoords: number[] = [];

  /**
   * Preselected L/R path per ball id. When present, the engine will steer the ball along this path.
   */
  private preselectedPaths: Record<number, { directions: ('L' | 'R')[]; step: number }> = {};

  static WIDTH = 760;
  static HEIGHT = 570;

  private static PADDING_X = 52;
  private static PADDING_TOP = 36;
  private static PADDING_BOTTOM = 28;

  private static PIN_CATEGORY = 0x0001;
  private static BALL_CATEGORY = 0x0002;

  /**
   * Friction parameters to be applied to the ball body.
   *
   * Higher friction leads to more concentrated distribution towards the center. These numbers
   * are found by trial and error to make the actual weighted bin payout very close to the
   * expected bin payout.
   */
  private static ballFrictions: BallFrictionsByRowCount = {
    friction: 0.5,
    frictionAirByRowCount: {
      8: 0.0395,
      9: 0.041,
      10: 0.038,
      11: 0.0355,
      12: 0.0414,
      13: 0.0437,
      14: 0.0401,
      15: 0.0418,
      16: 0.0364,
    },
  };

  /**
   * Creates the engine and the game's layout.
   *
   * @param canvas The canvas element to render the game to.
   *
   * @remarks This constructor does NOT start the rendering and physics engine.
   * Call the `start` method to start the engine.
   */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.betAmount = get(betAmount);
    this.rowCount = get(rowCount);
    this.riskLevel = get(riskLevel);
    betAmount.subscribe((value) => (this.betAmount = value));
    rowCount.subscribe((value) => this.updateRowCount(value));
    riskLevel.subscribe((value) => (this.riskLevel = value));

    this.engine = Matter.Engine.create({
      timing: {
        timeScale: 1,
      },
    });
    this.render = Matter.Render.create({
      engine: this.engine,
      canvas: this.canvas,
      options: {
        width: PlinkoEngine.WIDTH,
        height: PlinkoEngine.HEIGHT,
        background: '#0f1728',
        wireframes: false,
      },
    });
    this.runner = Matter.Runner.create();

    this.placePinsAndWalls();

    this.sensor = Matter.Bodies.rectangle(
      this.canvas.width / 2,
      this.canvas.height,
      this.canvas.width,
      10,
      {
        isSensor: true,
        isStatic: true,
        render: {
          visible: false,
        },
      },
    );
    Matter.Composite.add(this.engine.world, [this.sensor]);
    Matter.Events.on(this.engine, 'collisionStart', ({ pairs }) => {
      pairs.forEach(({ bodyA, bodyB }) => {
        if (bodyA === this.sensor) {
          this.handleBallEnterBin(bodyB);
        } else if (bodyB === this.sensor) {
          this.handleBallEnterBin(bodyA);
        }
      });
    });

    // Per-tick steering to guide balls along preselected paths at each row.
    Matter.Events.on(this.engine, 'beforeUpdate', () => {
      this.steerBallsAlongPreselectedPaths();
    });
  }

  /**
   * Renders the game and starts the physics engine.
   */
  start() {
    Matter.Render.run(this.render); // Renders the scene to canvas
    Matter.Runner.run(this.runner, this.engine); // Starts the simulation in physics engine
  }

  /**
   * Stops (pauses) the rendering and physics engine.
   */
  stop() {
    Matter.Render.stop(this.render);
    Matter.Runner.stop(this.runner);
  }

  /**
   * Drops a new ball from the top with a random horizontal offset, and deducts the balance.
   */
  dropBall(targetBinIndex?: number) {
    const ballOffsetRangeX = this.pinDistanceX * 0.8;
    const ballRadius = this.pinRadius * 2;
    const { friction, frictionAirByRowCount } = PlinkoEngine.ballFrictions;

    const spawnX =
      typeof targetBinIndex === 'number'
        ? this.canvas.width / 2
        : getRandomBetween(
            this.canvas.width / 2 - ballOffsetRangeX,
            this.canvas.width / 2 + ballOffsetRangeX,
          );
    const restitution = typeof targetBinIndex === 'number' ? 0.6 : 0.8;

    const ball = Matter.Bodies.circle(spawnX, 0, ballRadius, {
      restitution,
      friction,
      frictionAir: frictionAirByRowCount[this.rowCount],
      collisionFilter: {
        category: PlinkoEngine.BALL_CATEGORY,
        mask: PlinkoEngine.PIN_CATEGORY, // Collide with pins only, but not other balls
      },
      render: {
        fillStyle: '#ff0000',
      },
    });
    Matter.Composite.add(this.engine.world, ball);

    betAmountOfExistingBalls.update((value) => ({ ...value, [ball.id]: this.betAmount }));
    balance.update((balance) => balance - this.betAmount);

    // If a target bin is provided, precompute and store the L/R path for steering.
    if (typeof targetBinIndex === 'number') {
      const clampedTarget = Math.max(0, Math.min(this.rowCount, Math.floor(targetBinIndex)));
      const directions = this.computeLRPath(clampedTarget);
      this.preselectedPaths[ball.id] = { directions, step: 0 };
    }
  }

  /**
   * Total width of all bins as percentage of the canvas width.
   */
  get binsWidthPercentage(): number {
    const lastPinX = this.pinsLastRowXCoords[this.pinsLastRowXCoords.length - 1];
    return (lastPinX - this.pinsLastRowXCoords[0]) / PlinkoEngine.WIDTH;
  }

  /**
   * Gets the horizontal distance between each pin's center point.
   */
  private get pinDistanceX(): number {
    const lastRowPinCount = 3 + this.rowCount - 1;
    return (this.canvas.width - PlinkoEngine.PADDING_X * 2) / (lastRowPinCount - 1);
  }

  private get pinRadius(): number {
    return (24 - this.rowCount) / 2;
  }

  /**
   * Refreshes the game with a new number of rows.
   *
   * Does nothing if the new row count equals the current count.
   */
  private updateRowCount(rowCount: RowCount) {
    if (rowCount === this.rowCount) {
      return;
    }

    this.removeAllBalls();

    this.rowCount = rowCount;
    this.placePinsAndWalls();
  }

  /**
   * Called when a ball hits the invisible sensor at the bottom.
   */
  private handleBallEnterBin(ball: Matter.Body) {
    const binIndex = this.pinsLastRowXCoords.findLastIndex((pinX) => pinX < ball.position.x);
    if (binIndex !== -1 && binIndex < this.pinsLastRowXCoords.length - 1) {
      const betAmount = get(betAmountOfExistingBalls)[ball.id] ?? 0;
      const multiplier = binPayouts[this.rowCount][this.riskLevel][binIndex];
      const payoutValue = betAmount * multiplier;
      const profit = payoutValue - betAmount;

      winRecords.update((records) => [
        ...records,
        {
          id: uuidv4(),
          betAmount,
          rowCount: this.rowCount,
          binIndex,
          payout: {
            multiplier,
            value: payoutValue,
          },
          profit,
        },
      ]);
      totalProfitHistory.update((history) => {
        const lastTotalProfit = history.slice(-1)[0];
        return [...history, lastTotalProfit + profit];
      });
      balance.update((balance) => balance + payoutValue);
    }

    Matter.Composite.remove(this.engine.world, ball);
    betAmountOfExistingBalls.update((value) => {
      const newValue = { ...value };
      delete newValue[ball.id];
      return newValue;
    });

    // Clean up any preselected path state for this ball
    delete this.preselectedPaths[ball.id];
  }

  /**
   * Renders the pins and walls. Previous ones are removed before rendering new ones.
   */
  private placePinsAndWalls() {
    const { PADDING_X, PADDING_TOP, PADDING_BOTTOM, PIN_CATEGORY, BALL_CATEGORY } = PlinkoEngine;

    if (this.pins.length > 0) {
      Matter.Composite.remove(this.engine.world, this.pins);
      this.pins = [];
    }
    if (this.pinsLastRowXCoords.length > 0) {
      this.pinsLastRowXCoords = [];
    }
    if (this.rowYCoords.length > 0) {
      this.rowYCoords = [];
    }
    if (this.walls.length > 0) {
      Matter.Composite.remove(this.engine.world, this.walls);
      this.walls = [];
    }

    for (let row = 0; row < this.rowCount; ++row) {
      const rowY =
        PADDING_TOP +
        ((this.canvas.height - PADDING_TOP - PADDING_BOTTOM) / (this.rowCount - 1)) * row;

      // Record the y position for each row to time steering
      this.rowYCoords.push(rowY);

      /** Horizontal distance between canvas left/right boundary and first/last pin of the row. */
      const rowPaddingX = PADDING_X + ((this.rowCount - 1 - row) * this.pinDistanceX) / 2;

      for (let col = 0; col < 3 + row; ++col) {
        const colX = rowPaddingX + ((this.canvas.width - rowPaddingX * 2) / (3 + row - 1)) * col;
        const pin = Matter.Bodies.circle(colX, rowY, this.pinRadius, {
          isStatic: true,
          render: {
            fillStyle: '#ffffff',
          },
          collisionFilter: {
            category: PIN_CATEGORY,
            mask: BALL_CATEGORY, // Collide with balls
          },
        });
        this.pins.push(pin);

        if (row === this.rowCount - 1) {
          this.pinsLastRowXCoords.push(colX);
        }
      }
    }
    Matter.Composite.add(this.engine.world, this.pins);

    const firstPinX = this.pins[0].position.x;
    const leftWallAngle = Math.atan2(
      firstPinX - this.pinsLastRowXCoords[0],
      this.canvas.height - PADDING_TOP - PADDING_BOTTOM,
    );
    const leftWallX =
      firstPinX - (firstPinX - this.pinsLastRowXCoords[0]) / 2 - this.pinDistanceX * 0.25;

    const leftWall = Matter.Bodies.rectangle(
      leftWallX,
      this.canvas.height / 2,
      10,
      this.canvas.height,
      {
        isStatic: true,
        angle: leftWallAngle,
        render: { visible: false },
      },
    );
    const rightWall = Matter.Bodies.rectangle(
      this.canvas.width - leftWallX,
      this.canvas.height / 2,
      10,
      this.canvas.height,
      {
        isStatic: true,
        angle: -leftWallAngle,
        render: { visible: false },
      },
    );
    this.walls.push(leftWall, rightWall);
    Matter.Composite.add(this.engine.world, this.walls);
  }

  /**
   * Compute an L/R path for a given target bin index across the current row count.
   * For a Galton board, reaching bin k after n rows requires exactly k right moves.
   * This distributes the right moves roughly evenly over the rows for a natural path.
   */
  private computeLRPath(targetBinIndex: number): ('L' | 'R')[] {
    const n = this.rowCount;
    const k = Math.max(0, Math.min(n, targetBinIndex));
    const directions: ('L' | 'R')[] = [];
    for (let i = 1; i <= n; i++) {
      const prev = Math.floor(((i - 1) * k) / n);
      const curr = Math.floor((i * k) / n);
      directions.push(curr > prev ? 'R' : 'L');
    }
    return directions;
  }

  /**
   * Steer balls that have preselected paths by applying a small horizontal force
   * when they reach each row's y coordinate.
   */
  private steerBallsAlongPreselectedPaths() {
    if (this.rowYCoords.length === 0) return;

    const allBodies = Matter.Composite.allBodies(this.engine.world);
    for (const body of allBodies) {
      if (body.collisionFilter.category !== PlinkoEngine.BALL_CATEGORY) continue;
      const pathState = this.preselectedPaths[body.id];
      if (!pathState) continue;

      const { directions } = pathState;
      let { step } = pathState;
      if (step >= directions.length) continue;

      const threshold = this.pinRadius * 1.2;
      // Catch up if the body crossed multiple rows in one tick
      while (step < directions.length && body.position.y + threshold >= this.rowYCoords[step]) {
        const dir = directions[step];
        const forceMagnitude = 0.003; // stronger horizontal nudge
        const vxBoost = 2.2; // directly bias horizontal velocity
        const maxVx = 3.5;

        const forceX = dir === 'R' ? forceMagnitude : -forceMagnitude;
        Matter.Body.applyForce(body, body.position, { x: forceX, y: 0 });

        const desiredVx = dir === 'R' ? Math.min(maxVx, Math.abs(body.velocity.x) + vxBoost) : -Math.min(maxVx, Math.abs(body.velocity.x) + vxBoost);
        Matter.Body.setVelocity(body, { x: desiredVx, y: body.velocity.y });

        step += 1;
      }
      this.preselectedPaths[body.id] = { directions, step };
    }
  }

  private removeAllBalls() {
    Matter.Composite.allBodies(this.engine.world).forEach((body) => {
      if (body.collisionFilter.category === PlinkoEngine.BALL_CATEGORY) {
        Matter.Composite.remove(this.engine.world, body);
      }
    });
    betAmountOfExistingBalls.set({});
  }
}

export default PlinkoEngine;
