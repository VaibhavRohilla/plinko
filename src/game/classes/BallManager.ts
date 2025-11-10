import { HEIGHT, WIDTH, ballRadius as constBallRadius, obstacleRadius as constObstacleRadius } from "../constants";
import { createObstacles, createSinks, type Obstacle, type Sink } from "../objects";
import { pad, unpad, DECIMAL_MULTIPLIER } from "../padding";
import { Ball } from "./Ball";
import { getMultipliersFor, type RiskLevel } from "../multipliers";
import { outcomesByRows } from "../outcomesByRows";

export type BallManagerConfig = {
    rows: number;
    glowFill?: boolean; // when true, draw filled glow; otherwise halo ring
    glowIntensity?: number; // 0..2 scaling for glow size/alpha
    glowColor?: string; // CSS rgb tuple string used in rgba(), e.g. "255,255,0"
    sinkGapPx?: number; // vertical gap between lowest collider and top of bins
    risk?: RiskLevel;
    calibrationRows?: number; // rows count used when the provided offsets were calibrated (defaults to 16)
    calibrationObstacleRadiusPx?: number; // obstacle radius used when offsets were calibrated (defaults to constants.obstacleRadius)
    calibrationBallRadiusPx?: number; // ball radius used when offsets were calibrated (defaults to constants.ballRadius)
};

export class BallManager {
    private balls: Ball[];
    private canvasRef: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private obstacles: Obstacle[]
    private sinks: Sink[]
    private requestId?: number;
    private onFinish?: (index: number,startX?: number) => void;
    private lastTimestamp?: number;

    private rows: number;
    private obstacleRadiusPx: number;
    private ballRadiusPx: number;
    private sinkWidthPx: number;
    private glowFill: boolean;
    private glowIntensity: number;
    private glowColor: string;
    private sinkGapPx: number;
    private risk: RiskLevel;
    private calibrationRows: number;
    private calibrationObstacleRadiusPx: number;
    private calibrationBallRadiusPx: number;

    constructor(canvasRef: HTMLCanvasElement, onFinish?: (index: number,startX?: number) => void, config?: Partial<BallManagerConfig>) {
        this.balls = [];
        this.canvasRef = canvasRef;
        this.ctx = this.canvasRef.getContext("2d")!;
        this.rows = config?.rows ?? 16;
        // Dynamic geometry increases ball/collider when rows are low
        this.obstacleRadiusPx = this.computeObstacleRadius(this.rows);
        this.ballRadiusPx = this.computeBallRadius(this.rows);
        this.sinkWidthPx = this.computeSinkWidth(this.rows);
        this.obstacles = createObstacles(this.rows, this.obstacleRadiusPx);
        this.sinks = createSinks(this.getNumSinks(), this.sinkWidthPx);
        this.risk = config?.risk ?? 'low';
        this.calibrationRows = config?.calibrationRows ?? 16;
        this.calibrationObstacleRadiusPx = config?.calibrationObstacleRadiusPx ?? this.computeObstacleRadius(this.calibrationRows);
        this.calibrationBallRadiusPx = config?.calibrationBallRadiusPx ?? this.computeBallRadius(this.calibrationRows);
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

    /**
     * Returns the horizontal spacing in pixels between adjacent bottom-row pegs (unpadded).
     * Falls back to evenly spaced layout if geometry is unavailable.
     */
    getBottomRowCenterSpacingPx(): number {
        // Compute spacing exactly as used when creating obstacles:
        // safeWidth = WIDTH - 2 * horizontalPad, where horizontalPad = max(obstacleRadiusPx*2, 12)
        // baseSpacing = safeWidth / (rows + 1)
        const horizontalPadPx = Math.max(this.obstacleRadiusPx * 2, 12);
        const safeWidth = WIDTH - 2 * horizontalPadPx;
        return safeWidth / (this.rows + 1);
    }

    /**
     * Spacing helper for an arbitrary rows value using current geometry.
     */
    private getBottomRowCenterSpacingPxForRows(rows: number, obstacleRadiusPx?: number): number {
        const r = typeof obstacleRadiusPx === 'number' ? obstacleRadiusPx : this.obstacleRadiusPx;
        const horizontalPadPx = Math.max(r * 2, 12);
        const safeWidth = WIDTH - 2 * horizontalPadPx;
        return safeWidth / (Math.max(1, rows) + 1);
    }

    /**
     * Converts a center-based offset (in units of bottom-row spacing) into a padded canvas X.
     * Positive offsets move to the right from the board center.
     */
    getStartXPaddedForOffset(offset: number): number {
        const spacing = this.getBottomRowCenterSpacingPx();
        const centerX = WIDTH / 2 + spacing * offset;
        return pad(centerX);
    }

    /**
     * Scale factor between legacy offset normalization (WIDTH/(rows+1)) and true spacing (safeWidth/(rows+1)).
     * Legacy outcomes were normalized by total WIDTH; true mapping uses safeWidth that excludes horizontal padding.
     * Factor = (WIDTH / (rows+1)) / (safeWidth / (rows+1)) = WIDTH / safeWidth.
     */
    getLegacyOffsetScale(): number {
        const horizontalPadPx = Math.max(this.obstacleRadiusPx * 2, 12);
        const safeWidth = WIDTH - 2 * horizontalPadPx;
        return WIDTH / Math.max(1, safeWidth);
    }

    /**
     * Convert legacy normalized offset (based on WIDTH/(rows+1)) to the true offset used by getStartXPaddedForOffset.
     */
    normalizeLegacyOffset(legacyOffset: number): number {
        return legacyOffset * this.getLegacyOffsetScale();
    }

    /**
     * Convert an offset calibrated for one rows count to an offset for the current rows.
     */
    private rebaseOffsetBetweenRows(offset: number, fromRows: number, toRows: number, fromObstacleRadiusPx?: number, toObstacleRadiusPx?: number): number {
        const spacingFrom = this.getBottomRowCenterSpacingPxForRows(fromRows, fromObstacleRadiusPx);
        const spacingTo = this.getBottomRowCenterSpacingPxForRows(toRows, toObstacleRadiusPx);
        if (spacingTo === 0) return offset;
        return offset * (spacingFrom / spacingTo);
    }

    /**
     * Drop a ball to target bin index using precomputed offsets from outcomesByRows.
     * Returns the padded startX used for the drop (for debugging/validation).
     */
    dropToBinIndex(targetIndex: number, rowsOverride?: number): number | undefined {
        const rows = rowsOverride ?? this.rows ?? 16;
        if (rows !== this.rows) {
            this.setConfig({ rows });
        }
        const byIndex = outcomesByRows[rows];
        if (!byIndex || !byIndex[targetIndex] || byIndex[targetIndex].length === 0) {
            return undefined;
        }
        const offsets = byIndex[targetIndex];
        const chosenOffset = offsets[Math.floor(Math.random() * offsets.length)];
        const startX = this.getStartXPaddedForOffset(chosenOffset);
        this.addBall(startX);
        return startX;
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

    /**
     * Returns bottom-row peg X positions (unpadded, ascending).
     */
    private getBottomRowPegXs(): number[] {
        if (!this.obstacles || this.obstacles.length === 0) return [];
        let maxYPadded = this.obstacles[0].y;
        for (const o of this.obstacles) {
            if (o.y > maxYPadded) maxYPadded = o.y;
        }
        const bottomRow = this.obstacles
            .filter(o => o.y === maxYPadded)
            .map(o => unpad(o.x))
            .sort((a, b) => a - b);
        return bottomRow;
    }

    /**
     * Returns bin center X positions (unpadded) as the midpoints between adjacent bottom pegs.
     */
    getBinCentersPx(): number[] {
        const pegXs = this.getBottomRowPegXs();
        const centers: number[] = [];
        for (let i = 0; i + 1 < pegXs.length; i++) {
            centers.push((pegXs[i] + pegXs[i + 1]) / 2);
        }
        return centers;
    }

    /**
     * Predict which bin a given start X (unpadded) is closest to, using geometric bin centers.
     */
    predictIndexForStartXPx(startXPx: number): number | undefined {
        const centers = this.getBinCentersPx();
        if (centers.length === 0) return undefined;
        let bestIdx = 0;
        let bestDist = Math.abs(startXPx - centers[0]);
        for (let i = 1; i < centers.length; i++) {
            const d = Math.abs(startXPx - centers[i]);
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        return bestIdx;
    }

    /**
     * Interpret an arbitrary value (padded startX, pixel X, or normalized offset)
     * and return a padded startX that best targets the expected bin index (if provided).
     * - If |value| is very large, assume padded startX.
     * - Else if value looks like a pixel X, convert to padded.
     * - Else treat as normalized offset; decide between true vs legacy normalization by prediction.
     */
    interpretInputValueToStartX(value: number, expectedIndex?: number): number {
        const abs = Math.abs(value);
        const paddedLikelyThreshold = WIDTH * DECIMAL_MULTIPLIER * 0.05; // ~5% of full padded width
        const minPixelThreshold = Math.max(24, this.obstacleRadiusPx * 6); // avoid misclassifying small offsets as px
        // 1) Padded startX (very large magnitude)
        if (abs > paddedLikelyThreshold) {
            return value;
        }
        // 2) Raw pixel X
        if (value >= minPixelThreshold && value <= WIDTH) {
            return Math.floor(value * DECIMAL_MULTIPLIER);
        }
        // 3) Normalized offset: choose true vs legacy mapping using geometric prediction
        // Treat input as calibrated for calibrationRows, then rebase to current rows
        const trueCal = value;
        const legacyCal = this.normalizeLegacyOffset(value);
        const trueCur = this.rebaseOffsetBetweenRows(trueCal, this.calibrationRows, this.rows, this.calibrationObstacleRadiusPx, this.obstacleRadiusPx);
        const legacyCur = this.rebaseOffsetBetweenRows(legacyCal, this.calibrationRows, this.rows, this.calibrationObstacleRadiusPx, this.obstacleRadiusPx);
        const startXTrue = this.getStartXPaddedForOffset(trueCur);
        const startXLegacy = this.getStartXPaddedForOffset(legacyCur);
        if (typeof expectedIndex !== 'number') {
            return startXTrue; // default to true spacing if no preference
        }
        const pxTrue = unpad(startXTrue);
        const pxLegacy = unpad(startXLegacy);
        const predictedTrue = this.predictIndexForStartXPx(pxTrue);
        const predictedLegacy = this.predictIndexForStartXPx(pxLegacy);
        const scoreTrue = typeof predictedTrue === 'number' ? Math.abs(predictedTrue - expectedIndex) : Number.POSITIVE_INFINITY;
        const scoreLegacy = typeof predictedLegacy === 'number' ? Math.abs(predictedLegacy - expectedIndex) : Number.POSITIVE_INFINITY;
        return scoreTrue <= scoreLegacy ? startXTrue : startXLegacy;
    }

    /**
     * Convert a startX value back into a normalized offset (units of bottom-row spacing).
     * Accepts either padded or pixel units. Defaults to padded.
     */
    getOffsetForStartX(startX: number, isPadded: boolean = true): number {
        const sxPx = isPadded ? unpad(startX) : startX;
        const spacing = this.getBottomRowCenterSpacingPx();
        const centerX = WIDTH / 2;
        return (sxPx - centerX) / spacing;
    }

    setConfig(config: Partial<BallManagerConfig>) {
        // Update risk first (affects multipliers)
        if (config.risk) {
            this.risk = config.risk;
            this.applySinksMultipliers();
        }
        if (typeof config.calibrationRows === 'number') {
            this.calibrationRows = Math.max(1, Math.round(config.calibrationRows));
            // If caller didn't specify a calibration obstacle radius, derive it from calibration rows
            if (typeof config.calibrationObstacleRadiusPx !== 'number') {
                this.calibrationObstacleRadiusPx = this.computeObstacleRadius(this.calibrationRows);
            }
            if (typeof config.calibrationBallRadiusPx !== 'number') {
                this.calibrationBallRadiusPx = this.computeBallRadius(this.calibrationRows);
            }
        }
        if (typeof config.calibrationObstacleRadiusPx === 'number') {
            this.calibrationObstacleRadiusPx = config.calibrationObstacleRadiusPx;
        }
        if (typeof config.calibrationBallRadiusPx === 'number') {
            this.calibrationBallRadiusPx = config.calibrationBallRadiusPx;
        }
        // Update visual glow settings regardless of row changes
        if (typeof config.glowFill === 'boolean') this.glowFill = config.glowFill;
        if (typeof config.glowIntensity === 'number') this.glowIntensity = Math.max(0, Math.min(2, config.glowIntensity));
        if (typeof config.glowColor === 'string') this.glowColor = config.glowColor;

        // Geometry updates if rows changed
        if (config.rows && config.rows !== this.rows) {
            this.rows = config.rows;
            // Scale geometry with rows: larger ball/collider for fewer rows
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
        const sx = (typeof startX === 'number') ? startX : pad(WIDTH / 2 + 13);
        const newBall = new Ball(sx, pad(50), this.ballRadiusPx, 'red', this.ctx, this.obstacles, this.sinks, (index) => {
            this.balls = this.balls.filter(ball => ball !== newBall);
            // Report the actual startX used (padded), not the optional input param
            this.onFinish?.(index, sx)
        });
        this.balls.push(newBall);
    }

    private decayGlow(dtScale: number) {
        for (const o of this.obstacles) {
            if (o.glow && o.glow > 0) {
                o.glow = Math.max(0, o.glow - 0.05 * dtScale);
            }
        }
        // also decay sink animations
        for (const s of this.sinks) {
            if (s.glow && s.glow > 0) {
                s.glow = Math.max(0, s.glow - 0.04 * dtScale);
            }
            if (s.press && s.press > 0) {
                s.press = Math.max(0, s.press - 0.06 * dtScale);
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
            // Account for visual inflation in drawSinks() and Ball.update() where effective width is:
            // w_effective = sink.width * 1.5 - (sink.width * 0.15) = sink.width * 1.35
            const inflate = 1.5;
            const spacingRatio = 0.15;
            const effectiveFactor = inflate - spacingRatio; // 1.35
            const desiredWidth = Math.max(18, Math.floor((freeGap - 2 * sideClearance) / effectiveFactor));
            // Slightly smaller height to reduce vertical overlap on low rows (actual render uses height*2)
            const desiredHeight = Math.max(18, Math.floor(desiredWidth * 0.6));
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
        for (let i = 0; i < this.sinks.length; i++) {
            const sink = this.sinks[i];
            const colorInfo = this.getColor(i);

            const spacingVisual = sink.width * 0.15;
            const x = sink.x - spacingVisual;
            const pressAmt = sink.press ?? 0;
            const yBase = sink.y - sink.height / 2;
            const pressOffset = pressAmt * Math.max(2, Math.round(sink.height * 0.12));
            const y = yBase + pressOffset;
            const w = Math.max(12, sink.width * 1.5 - spacingVisual);
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

    draw(dtScale: number) {
        this.ctx.clearRect(0, 0, WIDTH, HEIGHT);
        this.decayGlow(dtScale);
        this.drawObstacles();
        // Draw balls before sinks so sinks render on top (ball appears underneath bins)
        this.balls.forEach(ball => {
            ball.draw();
            ball.update();
        });
        this.drawSinks();
    }
    
    update(timestamp?: number) {
        // compute dt scale relative to 60 FPS
        let dtScale = 1;
        if (typeof timestamp === 'number') {
            if (this.lastTimestamp === undefined) {
                this.lastTimestamp = timestamp;
                dtScale = 1;
            } else {
                const dtMs = Math.max(0, timestamp - this.lastTimestamp);
                const baseMs = 1000 / 60;
                dtScale = Math.min(2, dtMs / baseMs); // clamp to avoid spirals
                this.lastTimestamp = timestamp;
            }
        }
        this.draw(dtScale);
        this.requestId = requestAnimationFrame(this.update.bind(this));
    }

    stop() {
        if (this.requestId) {
            cancelAnimationFrame(this.requestId);
        }
    }
}