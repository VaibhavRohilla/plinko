import { HEIGHT, WIDTH } from "../constants";
import { createObstacles, createSinks, type Obstacle, type Sink } from "../objects";
import { pad, unpad } from "../padding";
import { Ball } from "./Ball";
import { getMultipliersFor, type RiskLevel } from "../multipliers";

export type BallManagerConfig = {
    rows: number;
    glowFill?: boolean; // when true, draw filled glow; otherwise halo ring
    glowIntensity?: number; // 0..2 scaling for glow size/alpha
    glowColor?: string; // CSS rgb tuple string used in rgba(), e.g. "255,255,0"
    sinkGapPx?: number; // vertical gap between lowest collider and top of bins
    risk?: RiskLevel;
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
    private glowFill: boolean;
    private glowIntensity: number;
    private glowColor: string;
    private sinkGapPx: number;
    private risk: RiskLevel;

    constructor(canvasRef: HTMLCanvasElement, onFinish?: (index: number,startX?: number) => void, config?: Partial<BallManagerConfig>) {
        this.balls = [];
        this.canvasRef = canvasRef;
        this.ctx = this.canvasRef.getContext("2d")!;
        this.rows = config?.rows ?? 16;
        this.obstacleRadiusPx = this.computeObstacleRadius(this.rows);
        this.ballRadiusPx = this.computeBallRadius(this.rows);
        this.sinkWidthPx = this.computeSinkWidth(this.rows);
        this.obstacles = createObstacles(this.rows, this.obstacleRadiusPx);
        this.sinks = createSinks(this.getNumSinks(), this.sinkWidthPx);
        this.risk = config?.risk ?? 'low';
        this.applySinksMultipliers();
        // glow defaults and overrides
        this.glowFill = config?.glowFill ?? true;
        const intensity = config?.glowIntensity ?? 1;
        this.glowIntensity = Math.max(0, Math.min(2, intensity));
        this.glowColor = config?.glowColor ?? '255,255,255';
        this.sinkGapPx = typeof config?.sinkGapPx === 'number' ? Math.max(8, config!.sinkGapPx!) : Math.max(16, Math.round(this.obstacleRadiusPx * 1.5));
        this.positionSinksBelowObstacles();
        this.update();
        this.onFinish = onFinish;
    }

    private computeObstacleRadius(rows: number) {
        const base = 5; // slightly larger than previous 4
        const scaled = base * (16 / Math.max(8, Math.min(16, rows)));
        return Math.max(3, Math.min(9, Math.round(scaled)));
    }

    private computeBallRadius(rows: number) {
        const base = 9; // larger than previous 7
        const scaled = base * (16 / Math.max(8, Math.min(16, rows)));
        return Math.max(5, Math.min(12, Math.round(scaled)));
    }

    private computeSinkWidth(rows: number) {
        const numSinks = this.getNumSinks(rows);
        // Use center spacing across full WIDTH and take a fraction for visual gap
        const centerSpacing = WIDTH / Math.max(1, numSinks);
        const width = centerSpacing * 0.7; // 70% of spacing, leaving 30% gap
        return Math.max(24, Math.floor(width));
    }

    getNumSinks(rowsOverride?: number) {
        const r = rowsOverride ?? this.rows;
        // With top row = 3 pegs and r total peg rows, bottom pegs = r + 2.
        // Bins (gaps) target = r + 1.
        return Math.max(4, r + 1);
    }

    getSinkWidth() {
        return this.sinkWidthPx;
    }

    setConfig(config: Partial<BallManagerConfig>) {
        // Update risk first (affects multipliers)
        if (config.risk) {
            this.risk = config.risk;
            this.applySinksMultipliers();
        }
        // Update visual glow settings regardless of row changes
        if (typeof config.glowFill === 'boolean') this.glowFill = config.glowFill;
        if (typeof config.glowIntensity === 'number') this.glowIntensity = Math.max(0, Math.min(2, config.glowIntensity));
        if (typeof config.glowColor === 'string') this.glowColor = config.glowColor;

        // Geometry updates if rows changed
        if (config.rows && config.rows !== this.rows) {
            this.rows = config.rows;
            this.obstacleRadiusPx = this.computeObstacleRadius(this.rows);
            this.ballRadiusPx = this.computeBallRadius(this.rows);
            this.sinkWidthPx = this.computeSinkWidth(this.rows);
            this.obstacles = createObstacles(this.rows, this.obstacleRadiusPx);
            this.sinks = createSinks(this.getNumSinks(), this.sinkWidthPx);
            this.applySinksMultipliers();
            this.positionSinksBelowObstacles();
            // clear balls when reconfiguring
            this.balls = [];
        }
    }

    addBall(startX?: number) {
        // Start above the canvas so it doesn't begin inside colliders
        const startYAboveCanvas = pad(-this.ballRadiusPx * 3);
        const newBall = new Ball(startX || pad(WIDTH / 2 + 13), startYAboveCanvas, this.ballRadiusPx, 'red', this.ctx, this.obstacles, this.sinks, (index) => {
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
        // also decay sink animations
        for (const s of this.sinks) {
            if (s.glow && s.glow > 0) {
                s.glow = Math.max(0, s.glow - 0.04);
            }
            if (s.press && s.press > 0) {
                s.press = Math.max(0, s.press - 0.06);
            }
        }
    }

    private applySinksMultipliers() {
        const desired = getMultipliersFor(this.rows, this.risk);
        if (!desired || desired.length !== this.getNumSinks()) {
            return;
        }
        for (let i = 0; i < this.sinks.length; i++) {
            this.sinks[i].multiplier = desired[i];
        }
    }

    private positionSinksBelowObstacles() {
        if (!this.obstacles || this.obstacles.length === 0) return;
        let maxYPadded = this.obstacles[0].y;
        for (const o of this.obstacles) {
            if (o.y > maxYPadded) maxYPadded = o.y;
        }
        const lastObstacleY = unpad(maxYPadded);
        const bottomOfPins = lastObstacleY + this.obstacleRadiusPx;
        const desiredTop = bottomOfPins + this.sinkGapPx;

        // Collect bottom-row obstacles (those exactly at maxYPadded)
        const bottomRow = this.obstacles
            .filter(o => o.y === maxYPadded)
            .map(o => ({ x: unpad(o.x), y: unpad(o.y) }))
            .sort((a, b) => a.x - b.x);

        // Per-bin layout based on true peg gap minus radii with small side clearance
        const sideClearance = Math.max(1, Math.round(this.obstacleRadiusPx * 0.35));
        for (let i = 0; i < this.sinks.length; i++) {
            const leftPeg = bottomRow[i];
            const rightPeg = bottomRow[i + 1];
            if (!leftPeg || !rightPeg) continue;
            const gapWidth = rightPeg.x - leftPeg.x;
            const freeGap = gapWidth - 2 * this.obstacleRadiusPx; // subtract peg radii edges
            const desiredWidth = Math.max(24, Math.floor(freeGap - 2 * sideClearance));
            const desiredHeight = Math.max(22, Math.floor(desiredWidth * 0.8));
            const centerX = (leftPeg.x + rightPeg.x) / 2;
            const leftX = centerX - desiredWidth / 2;
            const centerY = Math.min(desiredTop + desiredHeight / 2, HEIGHT - 40);

            const s = this.sinks[i];
            s.x = leftX;
            s.y = centerY;
            s.width = desiredWidth;
            s.height = desiredHeight;
        }
    }

    private drawRoundedRect(x: number, y: number, width: number, height: number, radius: number) {
        const r = Math.min(radius, width / 2, height / 2);
        this.ctx.beginPath();
        this.ctx.moveTo(x + r, y);
        this.ctx.lineTo(x + width - r, y);
        this.ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        this.ctx.lineTo(x + width, y + height - r);
        this.ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        this.ctx.lineTo(x + r, y + height);
        this.ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        this.ctx.lineTo(x, y + r);
        this.ctx.quadraticCurveTo(x, y, x + r, y);
        this.ctx.closePath();
    }

    drawObstacles() {
        this.obstacles.forEach((obstacle) => {
            const cx = unpad(obstacle.x);
            const cy = unpad(obstacle.y);
            const r = obstacle.radius;
            const glow = obstacle.glow ?? 0;

            if (glow > 0) {
                const sizeScale = Math.max(0.5, this.glowIntensity);
                const outer = r + glow * 14 * sizeScale;
                const inner = this.glowFill ? 0 : (r + Math.max(2, glow * 6 * sizeScale));
                const gradient = this.ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);

                if (this.glowFill) {
                    const alpha = Math.min(0.8, 0.5 + 0.3 * glow) * Math.min(1.5, this.glowIntensity);
                    gradient.addColorStop(0, `rgba(${this.glowColor}, ${alpha})`);
                    gradient.addColorStop(1, `rgba(${this.glowColor}, 0)`);
                } else {
                    gradient.addColorStop(0, `rgba(${this.glowColor}, 0)`);
                    gradient.addColorStop(0.6, `rgba(${this.glowColor}, ${0.4 * Math.min(1, this.glowIntensity)})`);
                    gradient.addColorStop(1, `rgba(${this.glowColor}, 0)`);
                }

                this.ctx.save();
                this.ctx.globalCompositeOperation = 'lighter';
                this.ctx.fillStyle = gradient;
                this.ctx.beginPath();
                this.ctx.arc(cx, cy, outer, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.closePath();
                this.ctx.restore();
            }

            this.ctx.beginPath();
            this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fill();
            this.ctx.closePath();
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
        const SPACING = this.sinkWidthPx*0.15;
        for (let i = 0; i < this.sinks.length; i++) {
            const sink = this.sinks[i];
            const colorInfo = this.getColor(i);

            const x = sink.x-sink.width*0.15;
            const pressAmt = sink.press ?? 0;
            const yBase = sink.y - sink.height / 2;
            const pressOffset = pressAmt * Math.max(2, Math.round(sink.height * 0.12));
            const y = yBase + pressOffset;
            const w = Math.max(12, sink.width*1.5 - SPACING);
            const h = sink.height*2;
            const radius = Math.min(14, h / 2.6);

            // bin glow when ball enters
            if ((sink.glow ?? 0) > 0) {
                const gx = x + w / 2;
                const gy = y + h / 2;
                const rgb = this.hexToRgb(colorInfo.background) || { r: 255, g: 255, b: 255 };
                const glowR = Math.max(w, h) * (0.6 + 0.6 * (sink.glow ?? 0));
                const grad = this.ctx.createRadialGradient(gx, gy, 0, gx, gy, glowR);
                grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.35 * (sink.glow ?? 0)})`);
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                this.ctx.save();
                this.ctx.globalCompositeOperation = 'lighter';
                this.ctx.fillStyle = grad;
                this.ctx.beginPath();
                this.ctx.arc(gx, gy, glowR, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.closePath();
                this.ctx.restore();
            }

            // flat style: bottom shadow + solid fill + dark border
            this.ctx.save();
            const shadowOffset = Math.max(2, Math.round(h * 0.12));
            this.ctx.fillStyle = 'rgba(0,0,0,0.4)';
            this.drawRoundedRect(x, y + shadowOffset, w, h, radius);
            this.ctx.fill();
            this.ctx.restore();

            this.ctx.fillStyle = colorInfo.background;
            this.drawRoundedRect(x, y, w, h, radius);
            this.ctx.fill();

            this.ctx.lineWidth = 3;
            this.ctx.strokeStyle = '#0a0a0a';
            this.ctx.stroke();

            // outlined white label
            const fontPx = Math.max(12, Math.floor(Math.min(w * 0.35, h * 0.6)));
            this.ctx.font = `bold ${fontPx}px Arial`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            const centerX = x + w / 2;
            const centerY = y + h / 2;
            const mult = (sink?.multiplier) ?? 1;
            let label: string;
            if (Math.abs(mult - Math.round(mult)) < 1e-6) {
                label = String(Math.round(mult));
            } else if (mult >= 1) {
                label = (Math.round(mult * 10) / 10).toString();
            } else {
                const v = Math.round(mult * 100) / 100; // up to 2 decimals
                label = v.toString().replace(/\.0+$/, '').replace(/(\.[1-9])0$/, '$1');
            }
            this.ctx.lineWidth = Math.max(2, Math.round(fontPx * 0.22));
            this.ctx.strokeStyle = '#000000';
            this.ctx.strokeText(label, centerX, centerY);
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillText(label, centerX, centerY);
        }
    }

    private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!m) return null;
        return {
            r: parseInt(m[1], 16),
            g: parseInt(m[2], 16),
            b: parseInt(m[3], 16),
        };
    }

    draw() {
        this.ctx.clearRect(0, 0, WIDTH, HEIGHT);
        this.decayGlow();
        this.drawObstacles();
        // Draw balls before sinks so sinks render on top (ball appears underneath bins)
        this.balls.forEach(ball => {
            ball.draw();
            ball.update();
        });
        this.drawSinks();
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