/**
 * Lightweight 2D spectrum renderer for minimal performance mode.
 */

class MinimalSpectrumSystem {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext("2d");
        this.barCount = 56;
        this.bars = new Float32Array(this.barCount);
        this.seeds = new Float32Array(this.barCount);
        this.audioLevel = 0;
        this.aiAudioLevel = 0;
        this.isExpanded = false;
        this.isThinking = false;
        this.isAiSpeaking = false;
        this.aiPrimed = false;
        this.frameId = 0;
        this.pixelRatio = 1;
        this.width = 0;
        this.height = 0;

        for (let i = 0; i < this.barCount; i++) {
            this.seeds[i] = Math.random() * Math.PI * 2;
        }

        this.onResize = this.onResize.bind(this);
        this.animate = this.animate.bind(this);
        window.addEventListener("resize", this.onResize);
        this.onResize();
        this.animate();
    }

    setExpanded(expanded) {
        this.isExpanded = expanded;
        if (expanded) {
            this.isThinking = false;
            this.aiPrimed = false;
        }
    }

    setExpandedForAI(expanded) {
        this.aiPrimed = expanded;
    }

    setThinking(active) {
        this.isThinking = active;
        if (active) {
            this.isExpanded = false;
            this.aiPrimed = false;
        }
    }

    setAiSpeaking(active) {
        this.isAiSpeaking = active;
        if (active) {
            this.isThinking = false;
            this.isExpanded = false;
            this.aiPrimed = true;
        } else {
            this.aiAudioLevel = 0;
            this.aiPrimed = false;
        }
    }

    setAudioLevel(level) {
        this.audioLevel = Math.max(0, Math.min(1, level || 0));
    }

    setAiAudioLevel(level) {
        this.aiAudioLevel = Math.max(0, Math.min(1, level || 0));
    }

    setColor() {
        // Minimal mode intentionally stays black on white.
    }

    resetColor() {
        // Minimal mode intentionally stays black on white.
    }

    onResize() {
        this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = Math.floor(this.width * this.pixelRatio);
        this.canvas.height = Math.floor(this.height * this.pixelRatio);
        this.canvas.style.width = `${this.width}px`;
        this.canvas.style.height = `${this.height}px`;
        this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    }

    getMode() {
        if (this.isExpanded) return "recording";
        if (this.isThinking) return "thinking";
        if (this.isAiSpeaking || this.aiPrimed) return "ai";
        return "idle";
    }

    getTargetHeight(index, now, mode) {
        const center = (this.barCount - 1) / 2;
        const distance = Math.abs(index - center) / center;
        const centerFalloff = Math.exp(-2.8 * distance * distance);
        const phase = index * 0.42 + now * 0.002 + this.seeds[index];

        if (mode === "recording") {
            const energy = Math.max(0.08, this.audioLevel);
            const wave = Math.abs(Math.sin(phase * 1.6));
            return 8 + (18 + energy * 150) * centerFalloff * (0.45 + wave * 0.75);
        }

        if (mode === "thinking") {
            const sweep = (Math.sin(now * 0.004 - index * 0.16) + 1) * 0.5;
            return 10 + (24 + sweep * 62) * (0.35 + centerFalloff * 0.65);
        }

        if (mode === "ai") {
            const energy = Math.max(this.aiAudioLevel, this.aiPrimed ? 0.1 : 0);
            const wave = Math.abs(Math.sin(phase * 1.2 + now * 0.001));
            return 10 + (24 + energy * 130) * (0.42 + wave * 0.58) * (0.55 + centerFalloff * 0.45);
        }

        const breath = (Math.sin(now * 0.0014) + 1) * 0.5;
        return 7 + (10 + breath * 8) * (0.45 + centerFalloff * 0.55);
    }

    drawBaseline(y, alpha) {
        this.ctx.save();
        this.ctx.globalAlpha = alpha;
        this.ctx.strokeStyle = "#000";
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(Math.max(24, this.width * 0.08), y);
        this.ctx.lineTo(Math.min(this.width - 24, this.width * 0.92), y);
        this.ctx.stroke();
        this.ctx.restore();
    }

    drawBars(now) {
        const mode = this.getMode();
        const usableWidth = Math.min(this.width * 0.64, 720);
        const startX = (this.width - usableWidth) / 2;
        const step = usableWidth / this.barCount;
        const barWidth = Math.max(2, Math.min(8, step * 0.42));
        const safeTop = Math.max(260, this.height * 0.34);
        const safeBottom = Math.min(this.height - 150, this.height * 0.76);
        const midY = (safeTop + safeBottom) / 2;
        const maxMainHeight = Math.max(32, (safeBottom - safeTop) * 0.34);
        const maxAuxHeight = Math.max(12, (safeBottom - safeTop) * 0.13);

        this.ctx.fillStyle = "#fff";
        this.ctx.fillRect(0, 0, this.width, this.height);
        this.drawBaseline(midY, mode === "idle" ? 0.16 : 0.28);

        this.ctx.fillStyle = "#000";
        this.ctx.strokeStyle = "#000";
        this.ctx.lineWidth = 1.4;

        for (let i = 0; i < this.barCount; i++) {
            const target = this.getTargetHeight(i, now, mode);
            this.bars[i] += (target - this.bars[i]) * (mode === "recording" || mode === "ai" ? 0.24 : 0.1);

            const x = startX + i * step + (step - barWidth) / 2;
            const h = Math.min(this.bars[i], maxMainHeight);
            const top = midY - h;
            this.ctx.fillRect(x, top, barWidth, h * 2);
        }

        if (mode === "ai") {
            const offset = Math.min(72, (safeBottom - safeTop) * 0.32);
            this.drawBaseline(midY - offset, 0.12);
            this.drawBaseline(midY + offset, 0.12);
            this.ctx.globalAlpha = 0.52;
            for (let i = 0; i < this.barCount; i += 2) {
                const x = startX + i * step + step * 0.3;
                const h = Math.min(this.bars[i] * 0.32, maxAuxHeight);
                this.ctx.fillRect(x, midY - offset - h, barWidth, h);
                this.ctx.fillRect(x, midY + offset, barWidth, h);
            }
            this.ctx.globalAlpha = 1;
        }
    }

    animate(now = performance.now()) {
        this.drawBars(now);
        this.frameId = requestAnimationFrame(this.animate);
    }
}

window.MinimalSpectrumSystem = MinimalSpectrumSystem;
