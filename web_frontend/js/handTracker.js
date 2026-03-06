/**
 * MediaPipe 手势追踪
 * 检测手掌打开/握拳状态 + 绘制手指骨架
 */

class HandTracker {
    constructor(videoElement, displayVideoElement, onGestureChange) {
        this.video = videoElement;
        this.displayVideo = displayVideoElement;
        this.onGestureChange = onGestureChange;
        
        this.currentGesture = null;
        this.isTracking = false;
        
        this.debounceTime = 400;
        this.lastGestureTime = 0;
        
        this.gestureHistory = [];
        this.historySize = 6;
        this.debug = false;
        
        this.canvas = null;
        this.ctx = null;
        this.lastResultAt = 0;
        this.frameErrorCount = 0;
        this.sendInFlight = false;
        this.restarting = false;
        this.watchdogTimer = null;
        this.restartCooldownUntil = 0;
        this.lastErrorLogAt = 0;
        this.handsReady = false;
    }

    dlog(...args) {
        if (this.debug) console.log(...args);
    }

    async waitForVideoReady(videoEl) {
        if (!videoEl) return;
        // HAVE_METADATA(1) 及以上说明可直接用于后续处理
        if (videoEl.readyState >= 1) return;
        await new Promise((resolve) => {
            const onReady = () => {
                videoEl.removeEventListener("loadedmetadata", onReady);
                resolve();
            };
            videoEl.addEventListener("loadedmetadata", onReady, { once: true });
        });
    }

    async getCameraStream() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("浏览器不支持 getUserMedia");
        }

        let videoInputs = [];
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            videoInputs = devices.filter((d) => d.kind === "videoinput");
        } catch (err) {
            this.dlog("enumerateDevices 失败:", err);
        }

        const constraintsList = [];
        if (videoInputs.length > 0) {
            // 优先按具体设备 ID 尝试，避免 facingMode 兼容差异导致的 NotFound
            for (const input of videoInputs.slice(0, 3)) {
                constraintsList.push({ video: { deviceId: { exact: input.deviceId }, width: 640, height: 480 } });
                constraintsList.push({ video: { deviceId: { exact: input.deviceId } } });
            }
        }

        constraintsList.push(
            { video: { width: 640, height: 480, facingMode: { ideal: "user" } } },
            { video: { width: 640, height: 480, facingMode: { ideal: "environment" } } },
            { video: { width: 640, height: 480 } },
            { video: true }
        );

        let lastErr = null;
        for (const constraints of constraintsList) {
            try {
                return await navigator.mediaDevices.getUserMedia(constraints);
            } catch (err) {
                lastErr = err;
                this.dlog("getUserMedia 尝试失败:", constraints, err);
            }
        }
        if (videoInputs.length === 0) {
            throw new Error("未检测到摄像头设备（videoinput=0）");
        }
        throw lastErr || new Error("No camera stream available");
    }

    async startPreviewOnly() {
        try {
            if (this.displayVideo && this.displayVideo.srcObject) {
                return true;
            }
            const stream = await this.getCameraStream();

            this.video.srcObject = stream;
            this.displayVideo.srcObject = stream;
            this.video.playsInline = true;
            this.video.muted = true;
            this.displayVideo.playsInline = true;
            this.displayVideo.muted = true;
            await this.video.play().catch(() => {});
            await this.displayVideo.play().catch(() => {});
            this.isTracking = false;
            return true;
        } catch (err) {
            console.error("摄像头预览启动失败:", err);
            return false;
        }
    }
    
    async init() {
        this.dlog('初始化手势跟踪器...');

        // 先启动摄像头预览，确保浏览器会立即触发权限请求
        const previewReady = await this.startPreviewOnly();
        if (!previewReady) {
            return false;
        }
        
        let retries = 0;
        while (typeof Hands === 'undefined' && retries < 50) {
            this.dlog('等待 Hands 库加载...', retries);
            await new Promise(r => setTimeout(r, 100));
            retries++;
        }
        
        if (typeof Hands === 'undefined') {
            console.warn('Hands 库未加载，降级为仅摄像头预览');
            return await this.startPreviewOnly();
        }
        
        this.dlog('Hands 库已加载');
        
        try {
            await this.waitForVideoReady(this.video);
            this.ensureOverlayCanvas();
            
            this.hands = new Hands({
                locateFile: (file) => `js/${file}`
            });
            
            this.hands.setOptions({
                maxNumHands: 1,
                modelComplexity: 0,
                minDetectionConfidence: 0.7,
                minTrackingConfidence: 0.5
            });
            
            this.hands.onResults((results) => this.onResults(results));
            this.handsReady = false;
            if (typeof this.hands.initialize === "function") {
                await this.hands.initialize();
            }
            this.handsReady = true;
            
            this.camera = new Camera(this.video, {
                onFrame: async () => {
                    if (this.restarting || !this.hands || !this.handsReady) return;
                    if (this.sendInFlight) return;
                    this.sendInFlight = true;
                    try {
                        await this.hands.send({ image: this.video });
                        this.frameErrorCount = 0;
                    } catch (err) {
                        await this.handleSendError(err);
                    } finally {
                        this.sendInFlight = false;
                    }
                },
                width: 640,
                height: 480
            });
            
            await this.camera.start();
            this.isTracking = true;
            this.lastResultAt = Date.now();
            this.frameErrorCount = 0;
            this.startWatchdog();
            
            this.dlog('✅ 手势跟踪器已启动');
            return true;
            
        } catch (err) {
            console.error('❌ 初始化失败:', err);
            // 手势初始化失败时，至少保证摄像头预览可用
            return await this.startPreviewOnly();
        }
    }

    ensureOverlayCanvas() {
        const parent = this.displayVideo && this.displayVideo.parentElement;
        if (!parent) return;
        parent.style.position = 'relative';

        if (this.canvas && this.canvas.parentElement === parent) {
            return;
        }

        if (this.canvas && this.canvas.parentElement) {
            this.canvas.parentElement.removeChild(this.canvas);
        }

        this.canvas = document.createElement('canvas');
        this.canvas.width = 640;
        this.canvas.height = 480;
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.transform = 'scaleX(-1)';
        parent.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');
    }

    startWatchdog() {
        if (this.watchdogTimer) return;
        this.watchdogTimer = setInterval(async () => {
            if (!this.isTracking || this.restarting) return;
            if (typeof document !== "undefined" && document.hidden) return;
            if (!this.video || this.video.paused || this.video.ended) return;
            const stalled = Date.now() - this.lastResultAt > 8000;
            if (stalled) {
                await this.requestRestart("watchdog_stall");
            }
        }, 3000);
    }

    async handleSendError(err) {
        this.frameErrorCount += 1;
        const now = Date.now();
        if (now - this.lastErrorLogAt > 2000) {
            const msg = (err && (err.message || err.toString())) || "unknown";
            console.warn(`Hands send 失败(x${this.frameErrorCount}): ${msg}`);
            this.lastErrorLogAt = now;
        }
        if (this.frameErrorCount >= 3) {
            await this.requestRestart("hands_send_error");
        }
    }

    async requestRestart(reason) {
        const now = Date.now();
        if (this.restarting) return;
        if (now < this.restartCooldownUntil) return;
        await this.restartTracking(reason);
    }

    async restartTracking(reason) {
        if (this.restarting) return;
        this.restarting = true;
        console.warn("重启手势追踪:", reason);
        try {
            this.isTracking = false;
            this.handsReady = false;
            if (this.camera) {
                this.camera.stop();
                this.camera = null;
            }
            if (this.hands) {
                if (typeof this.hands.close === "function") {
                    try { await this.hands.close(); } catch (_) {}
                }
                this.hands = null;
            }
            this.sendInFlight = false;
            await new Promise(r => setTimeout(r, 200));
            await this.init();
        } catch (err) {
            console.error("重启手势追踪失败:", err);
            await this.startPreviewOnly();
        } finally {
            this.restarting = false;
            this.restartCooldownUntil = Date.now() + 5000;
        }
    }
    
    distance(p1, p2) {
        return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
    }
    
    onResults(results) {
        this.lastResultAt = Date.now();
        if (this.ctx && this.canvas) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0];
            
            this.drawHandLandmarks(landmarks);
            
            const gesture = this.detectGesture(landmarks);
            
            const now = Date.now();
            if (gesture !== this.currentGesture) {
                this.gestureHistory.push(gesture);
                if (this.gestureHistory.length > this.historySize) {
                    this.gestureHistory.shift();
                }
                
                const counts = {};
                this.gestureHistory.forEach(g => counts[g] = (counts[g] || 0) + 1);
                const majority = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
                
                const threshold = Math.floor(this.historySize * 0.6);
                
                if (now - this.lastGestureTime > this.debounceTime && 
                    majority !== this.currentGesture && counts[majority] >= threshold 
) {
                    this.currentGesture = majority;
                    this.lastGestureTime = now;
                    
                    const isOpen = majority === 'open';
                    this.dlog('手势:', majority, isOpen ? '🖐️ 打开' : '✊ 握拳', counts);
                    if (this.onGestureChange) {
                        if (majority === 'open') {
                            this.onGestureChange(true, 'hand_open');
                        } else if (majority === 'closed') {
                            this.onGestureChange(false, 'hand_closed');
                        }
                    }
                }
            }
        } else {
            if (this.currentGesture && Date.now() - this.lastGestureTime > 1000) {
                this.currentGesture = null;
                if (this.onGestureChange) {
                    this.onGestureChange(false, 'no_hand');
                }
            }
        }
    }
    
    drawHandLandmarks(landmarks) {
        if (!this.ctx) return;
        
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        const connections = [
            [0, 1], [1, 2], [2, 3], [3, 4],
            [0, 5], [5, 6], [6, 7], [7, 8],
            [0, 9], [9, 10], [10, 11], [11, 12],
            [0, 13], [13, 14], [14, 15], [15, 16],
            [0, 17], [17, 18], [18, 19], [19, 20],
            [5, 9], [9, 13], [13, 17]
        ];
        
        this.ctx.strokeStyle = '#00FF00';
        this.ctx.lineWidth = 3;
        this.ctx.lineCap = 'round';
        
        for (const [i, j] of connections) {
            const p1 = landmarks[i];
            const p2 = landmarks[j];
            
            this.ctx.beginPath();
            this.ctx.moveTo(p1.x * w, p1.y * h);
            this.ctx.lineTo(p2.x * w, p2.y * h);
            this.ctx.stroke();
        }
        
        for (const landmark of landmarks) {
            this.ctx.beginPath();
            this.ctx.arc(landmark.x * w, landmark.y * h, 5, 0, 2 * Math.PI);
            this.ctx.fillStyle = '#FF0000';
            this.ctx.fill();
        }
    }
    
    detectGesture(landmarks) {
        const wrist = landmarks[0];
        const palmBase = landmarks[9];
        
        // 检查手指之间是否有重合（张开检测）
        // 食指和中指指尖的距离
        const indexTip = landmarks[8];
        const middleTip = landmarks[12];
        const ringTip = landmarks[16];
        const pinkyTip = landmarks[20];
        
        const idxMidDist = this.distance(indexTip, middleTip);
        const midRingDist = this.distance(middleTip, ringTip);
        const ringPinkyDist = this.distance(ringTip, pinkyTip);
        
        // 手指张开时，相邻指尖距离应该大于0.04
        if (idxMidDist < 0.04 || midRingDist < 0.04 || ringPinkyDist < 0.04) {
            this.dlog("手指有重合");
            return 'closed';
        }
        
        const palmLength = this.distance(wrist, palmBase);
        if (palmLength < 0.01) return 'closed';
        
        const fingerTips = [4, 8, 12, 16, 20];
        
        let extendedCount = 0;
        
        for (let i = 0; i < fingerTips.length; i++) {
            const tipIndex = fingerTips[i];
            const tip = landmarks[tipIndex];
            const fingerBase = landmarks[tipIndex - 2];
            
            const isUpward = tip.y < fingerBase.y;
            if (!isUpward) continue;
            
            const fingerLength = this.distance(wrist, tip);
            const ratio = fingerLength / palmLength;
            
            if (i === 0) {
                if (ratio > 1.0) extendedCount++;
            } else {
                if (ratio > 1.1) extendedCount++;
            }
        }
        
        this.dlog("展开手指数:", extendedCount);
        
        if (extendedCount === 5) {
            return 'open';
        } else {
            return 'closed';
        }
    }
    
    stop() {
        this.isTracking = false;
        if (this.watchdogTimer) {
            clearInterval(this.watchdogTimer);
            this.watchdogTimer = null;
        }
        if (this.camera) {
            this.camera.stop();
        }
        
        [this.video, this.displayVideo].forEach(el => {
            if (el && el.srcObject) {
                el.srcObject.getTracks().forEach(track => track.stop());
            }
        });
    }
}
