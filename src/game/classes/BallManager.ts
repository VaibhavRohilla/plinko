import { HEIGHT, WIDTH } from "../constants";
import { createObstacles, createSinks, type Obstacle, type Sink } from "../objects";
import { pad, unpad } from "../padding";
import { Ball } from "./Ball";

export type BallManagerConfig = {
    rows: number;
};

export class BallManager {
    private balls: Ball[];
    private canvasRef: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private obstacles: Obstacle[]
    private sinks: Sink[]
    private requestId?: number;
    private onFinish?: (index: number,startX?: number) => void;

    private rows: number;
    private obstacleRadiusPx: number;
    private ballRadiusPx: number;
    private sinkWidthPx: number;

    constructor(canvasRef: HTMLCanvasElement, onFinish?: (index: number,startX?: number) => void, config?: Partial<BallManagerConfig>) {
        this.balls = [];
        this.canvasRef = canvasRef;
        this.ctx = this.canvasRef.getContext("2d")!;
        this.rows = config?.rows ?? 18;
        this.obstacleRadiusPx = this.computeObstacleRadius(this.rows);
        this.ballRadiusPx = this.computeBallRadius(this.rows);
        this.sinkWidthPx = this.computeSinkWidth(this.rows);
        this.obstacles = createObstacles(this.rows, this.obstacleRadiusPx);
        this.sinks = createSinks(this.getNumSinks(), this.sinkWidthPx, this.obstacleRadiusPx);
        this.update();
        this.onFinish = onFinish;
    }

    private computeObstacleRadius(rows: number) {
        const base = 5; // slightly larger than previous 4
        const scaled = base * (18 / Math.max(8, Math.min(30, rows)));
        return Math.max(3, Math.min(9, Math.round(scaled)));
    }

    private computeBallRadius(rows: number) {
        const base = 9; // larger than previous 7
        const scaled = base * (18 / Math.max(8, Math.min(30, rows)));
        return Math.max(5, Math.min(12, Math.round(scaled)));
    }

    private computeSinkWidth(rows: number) {
        const numSinks = this.getNumSinks(rows);
        // fit sinks across width with a small margin
        const margin = 40;
        const available = WIDTH - margin;
        return Math.max(24, Math.floor(available / (numSinks + 1)));
    }

    getNumSinks(rowsOverride?: number) {
        const r = rowsOverride ?? this.rows;
        return Math.max(3, r - 1);
    }

    getSinkWidth() {
        return this.sinkWidthPx;
    }

    setConfig(config: Partial<BallManagerConfig>) {
        if (config.rows && config.rows !== this.rows) {
            this.rows = config.rows;
            this.obstacleRadiusPx = this.computeObstacleRadius(this.rows);
            this.ballRadiusPx = this.computeBallRadius(this.rows);
            this.sinkWidthPx = this.computeSinkWidth(this.rows);
            this.obstacles = createObstacles(this.rows, this.obstacleRadiusPx);
            this.sinks = createSinks(this.getNumSinks(), this.sinkWidthPx, this.obstacleRadiusPx);
            // clear balls when reconfiguring
            this.balls = [];
        }
    }

    addBall(startX?: number) {
        const newBall = new Ball(startX || pad(WIDTH / 2 + 13), pad(50), this.ballRadiusPx, 'red', this.ctx, this.obstacles, this.sinks, (index) => {
            this.balls = this.balls.filter(ball => ball !== newBall);
            this.onFinish?.(index, startX)
        });
        this.balls.push(newBall);
    }

    private decayGlow() {
        for (const o of this.obstacles) {
            if (o.glow && o.glow > 0) {
                o.glow = Math.max(0, o.glow - 0.05);
            }
        }
    }

    drawObstacles() {
        this.ctx.fillStyle = 'white';
        this.obstacles.forEach((obstacle) => {
            const glow = obstacle.glow ?? 0;
            if (glow > 0) {
                this.ctx.save();
                this.ctx.shadowColor = 'rgba(255,255,0,0.8)';
                this.ctx.shadowBlur = 10 * glow + 5;
                this.ctx.beginPath();
                this.ctx.arc(unpad(obstacle.x), unpad(obstacle.y), obstacle.radius + glow, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.closePath();
                this.ctx.restore();
            } else {
                this.ctx.beginPath();
                this.ctx.arc(unpad(obstacle.x), unpad(obstacle.y), obstacle.radius, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.closePath();
            }
        });
    }
  
    getColor(index: number) {
        if (index <3 || index > this.sinks.length - 3) {
            return {background: '#ff003f', color: 'white'};
        }
        if (index < 6 || index > this.sinks.length - 6) {
            return {background: '#ff7f00', color: 'white'};
        }
        if (index < 9 || index > this.sinks.length - 9) {
            return {background: '#ffbf00', color: 'black'};
        }
        if (index < 12 || index > this.sinks.length - 12) {
            return {background: '#ffff00', color: 'black'};
        }
        if (index < 15 || index > this.sinks.length - 15) {
            return {background: '#bfff00', color: 'black'};
        }
        return {background: '#7fff00', color: 'black'};
    }
    drawSinks() {
        this.ctx.fillStyle = 'green';
        const SPACING = this.obstacleRadiusPx * 2;
        for (let i = 0; i<this.sinks.length; i++)  {
            this.ctx.fillStyle = this.getColor(i).background;
            const sink = this.sinks[i];
            this.ctx.font='normal 13px Arial';
            this.ctx.fillRect(sink.x, sink.y - sink.height / 2, sink.width - SPACING, sink.height);
            this.ctx.fillStyle = this.getColor(i).color;
            this.ctx.fillText((sink?.multiplier)?.toString() + "x", sink.x - 15 + this.sinkWidthPx / 2, sink.y);
        };
    }

    draw() {
        this.ctx.clearRect(0, 0, WIDTH, HEIGHT);
        this.decayGlow();
        this.drawObstacles();
        this.drawSinks();
        this.balls.forEach(ball => {
            ball.draw();
            ball.update();
        });
    }
    
    update() {
        this.draw();
        this.requestId = requestAnimationFrame(this.update.bind(this));
    }

    stop() {
        if (this.requestId) {
            cancelAnimationFrame(this.requestId);
        }
    }
}