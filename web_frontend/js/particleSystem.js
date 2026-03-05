/**
 * Three.js 粒子特效系统
 */

class ParticleSystem {
    constructor(canvasId) {
        this.perf = window.__APP_PERF__ || {};
        this.debug = false;
        this.canvas = document.getElementById(canvasId);
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.canvas, 
            alpha: true,
            antialias: this.perf.antialias !== undefined ? this.perf.antialias : true 
        });
        
        this.renderer.setClearColor(0x000000, 0);
        
        // 根据性能模式动态调整粒子数量
        this.particleCount = this.perf.particleCount || 3500;
        this.isExpanded = false;
        
        this.audioLevel = 0;
        this.baseScale = 1;
        this.targetScale = 1;
        this.currentScale = 1;
        
        this.useCustomColor = false;
        this.targetColor = new THREE.Color(0x00d2ff);
        this.currentColor = new THREE.Color(0x00d2ff);
        this.lastAppliedColor = new THREE.Color(-1, -1, -1);
        this.forceColorUpdate = true;
        
        this.audioThreshold = 0.2;
        this.isThinking = false;
        this.thinkingColors = [
            new THREE.Color(0xff3b30), // 红
            new THREE.Color(0xff9500), // 橙
            new THREE.Color(0xffcc00), // 黄
            new THREE.Color(0x34c759), // 绿
            new THREE.Color(0x00c7be), // 青
            new THREE.Color(0x007aff), // 蓝
            new THREE.Color(0xaf52de), // 紫
        ];
        this.thinkingColorTemp = new THREE.Color();
        this.recordingColorA = new THREE.Color(0xffcc00); // 黄
        this.recordingColorB = new THREE.Color(0xff8a00); // 橙
        this.recordingColorTemp = new THREE.Color();
        this.aiColorA = new THREE.Color(0x3a7bd5); // 蓝
        this.aiColorB = new THREE.Color(0x9b59b6); // 紫
        this.aiColorTemp = new THREE.Color();
        this.colorMode = 'uniform';
        this.isAiSpeaking = false;
        this.aiAudioLevel = 0;
        this.frameIndex = 0;
        if (this.perf.mode === 'low') {
            this.updateEveryNFrames = 3;
        } else if (this.perf.mode === 'balanced') {
            this.updateEveryNFrames = 2;
        } else {
            this.updateEveryNFrames = 1;
        }
        
        this.init();
    }

    dlog(...args) {
        if (this.debug) console.log(...args);
    }

    colorDiffSquared(a, b) {
        const dr = a.r - b.r;
        const dg = a.g - b.g;
        const db = a.b - b.b;
        return dr * dr + dg * dg + db * db;
    }
    
    init() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        const pixelRatioCap = this.perf.pixelRatioCap || 2;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
        
        this.camera.position.z = 50;
        
        this.createParticles();
        
        window.addEventListener('resize', () => this.onResize());
        
        this.animate();
    }
    
    createParticles() {
        const geometry = new THREE.BufferGeometry();
        
        const positions = new Float32Array(this.particleCount * 3);
        const colors = new Float32Array(this.particleCount * 3);
        
        const colorPalette = [
            new THREE.Color(0x00d2ff),
            new THREE.Color(0x3a7bd5),
            new THREE.Color(0x9b59b6),
            new THREE.Color(0x8e44ad),
        ];
        
        // 生成空心球体分布
        // 关键点：r 应该固定或在很小范围内浮动，而不是大范围随机
        const baseRadius = 14; 
        
        for (let i = 0; i < this.particleCount; i++) {
            // 使用球面坐标生成均匀分布
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            
            // 在表面增加微量厚度，更有质感
            const r = baseRadius + (Math.random() - 0.5) * 1.5;
            
            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = r * Math.cos(phi);
            
            const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        
        const material = new THREE.PointsMaterial({
            size: 0.35, // 稍微再调小一点，增加留白
            vertexColors: true,
            transparent: true,
            opacity: 0.85, // 降低一点不透明度，增加通透感
            sizeAttenuation: true
        });
        
        this.particles = new THREE.Points(geometry, material);
        this.scene.add(this.particles);
        
        this.originalPositions = positions.slice();
        this.originalColors = colors.slice();
        this.recordingNormX = new Float32Array(this.particleCount);
        this.recordingAttenuation = new Float32Array(this.particleCount);
        this.recordingNoiseSeed = new Float32Array(this.particleCount);
        this.thinkingGridTheta = new Float32Array(this.particleCount);
        this.thinkingGridPhi = new Float32Array(this.particleCount);

        // 预计算思考态使用的网格角度，避免每帧 atan2/acos/sqrt/round
        for (let i = 0; i < this.particleCount; i++) {
            const i3 = i * 3;
            const ox = this.originalPositions[i3];
            const oy = this.originalPositions[i3 + 1];
            const oz = this.originalPositions[i3 + 2];

            // 预计算录音态的中心衰减参数，避免每帧重复算 exp
            const normX = ox / 15;
            this.recordingNormX[i] = normX;
            this.recordingAttenuation[i] = Math.exp(-2 * normX * normX);
            this.recordingNoiseSeed[i] = Math.random() * Math.PI * 2;

            const length = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
            const theta = Math.atan2(ox, oz);
            const phi = Math.acos(Math.max(-1, Math.min(1, oy / length)));
            this.thinkingGridTheta[i] = Math.round(theta * 10) / 10;
            this.thinkingGridPhi[i] = Math.round(phi * 5) / 5;
        }
    }
    
    setExpanded(expanded) {
        this.isExpanded = expanded;
        this.dlog("setExpanded called, expanded =", expanded);
        
        if (expanded) {
            this.baseScale = 2.5;
            this.targetScale = this.baseScale + this.audioLevel * 1.5;
            this.dlog("调用 setRecordingColor");
            this.setRecordingColor();
            this.targetColor = new THREE.Color(0xffd400);
        } else {
            this.baseScale = 1;
            this.targetScale = 1;
            this.resetColor();
        }
    }
    
    // AI 回复时放大
    setExpandedForAI(expanded) {
        this.dlog('ParticleSystem: setExpandedForAI =', expanded);
        if (expanded) {
            // AI 回复：放大到 1.3 倍
            this.targetScale = 1.3;
        } else {
            // 恢复：回到正常大小
            if (this.isExpanded) {
                // 如果还在录音，保持录音状态的大小
                this.targetScale = this.baseScale + this.audioLevel * 1.5;
            } else {
                // 如果不在录音，恢复到 1
                this.targetScale = 1;
            }
        }
    }
    
    setRecordingColor() {
        const colors = this.particles.geometry.attributes.color.array;
        
        for (let i = 0; i < this.particleCount; i++) {
            const i3 = i * 3;
            const ox = this.originalPositions[i3];
            const mix = (Math.sin(ox * 0.35) + 1) / 2;
            this.recordingColorTemp.copy(this.recordingColorA).lerp(this.recordingColorB, mix);
            colors[i3] = this.recordingColorTemp.r;
            colors[i3 + 1] = this.recordingColorTemp.g;
            colors[i3 + 2] = this.recordingColorTemp.b;
        }
        
        this.particles.geometry.attributes.color.needsUpdate = true;
        
        this.colorMode = 'recording';
    }
    
    setColor(hexColor) {
        this.dlog('ParticleSystem: setColor =', hexColor);
        this.useCustomColor = true;
        this.colorMode = 'uniform';
        this.targetColor = new THREE.Color(hexColor);
        this.forceColorUpdate = true;
    }
    
    setAudioLevel(level) {
        this.audioLevel = level;
        
        if (this.isExpanded) {
            if (level < this.audioThreshold) {
                this.targetScale = this.baseScale;
            } else {
                this.targetScale = this.baseScale + level * 1.5;
            }
        }
    }
    
    resetColor() {
        this.useCustomColor = false;
        this.colorMode = 'uniform';
        this.targetColor = new THREE.Color(0x00d2ff);
        this.forceColorUpdate = true;
    }

    setThinking(active) {
        this.isThinking = active;
        if (!active) {
            if (this.isExpanded) {
                this.targetScale = this.baseScale + this.audioLevel * 1.5;
            } else {
                this.targetScale = 1;
            }
            // 避免覆盖录音态/AI说话态的专属配色
            if (!this.isExpanded && !this.isAiSpeaking) {
                this.resetColor();
            }
        }
    }

    setAiSpeaking(active) {
        this.isAiSpeaking = active;
        if (active) {
            this.colorMode = 'ai_speaking';
        }
        if (!active) {
            this.aiAudioLevel = 0;
            if (!this.isExpanded && !this.isThinking) {
                this.targetScale = 1;
                this.resetColor();
            }
        }
    }

    setAiAudioLevel(level) {
        this.aiAudioLevel = level;
        if (!this.isExpanded && this.isAiSpeaking && !this.isThinking) {
            this.targetScale = 1 + level * 0.5;
        }
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        const now = performance.now();
        this.frameIndex += 1;
        const shouldUpdateParticles = (this.frameIndex % this.updateEveryNFrames) === 0;
        const positions = this.particles.geometry.attributes.position.array;
        let positionUpdated = false;
        let colorUpdated = false;

        if (shouldUpdateParticles && this.isExpanded) {
            // 录音状态：水平频谱带 (方案 A)
            // 随音量波动：中心更宽，两侧衰减
            // 增强 Y 轴抖动幅度，从 10 增加到 25，并且增加随机性
            const level = Math.max(0.1, this.audioLevel * 6.5);
            const time = now * 0.0032;
            
            for (let i = 0; i < this.particleCount; i++) {
                const i3 = i * 3;
                const ox = this.originalPositions[i3];
                const oz = this.originalPositions[i3 + 2];
                
                const normX = this.recordingNormX[i];
                const attenuation = this.recordingAttenuation[i];
                
                // 目标位置
                const targetX = ox * 3.3; // 拉得更长
                
                // 用确定性噪声替代每帧随机，减少抖动与 CPU 开销
                const wave = Math.sin(normX * 9 + time) * 6.5 * level;
                const noise = Math.sin(time * 2.0 + this.recordingNoiseSeed[i]) * 11 * level;
                
                const targetY = (wave + noise) * attenuation; 
                const targetZ = oz * 0.2; // 压扁
                
                positions[i3] += (targetX - positions[i3]) * 0.08;
                positions[i3 + 1] += (targetY - positions[i3 + 1]) * 0.24; // 声音变化更激烈
                positions[i3 + 2] += (targetZ - positions[i3 + 2]) * 0.1;
            }
            positionUpdated = true;
        } else if (shouldUpdateParticles && this.isThinking) {
            // 思考状态：编织网格
            // 粒子形成规则网格，并带有脉冲扩散
            const time = now * 0.002;
            
            // 七彩渐变逻辑：在 7 种颜色中循环插值
            const colorProgress = (now * 0.0006) % this.thinkingColors.length;
            const colorIndex = Math.floor(colorProgress);
            const nextColorIndex = (colorIndex + 1) % this.thinkingColors.length;
            const t = colorProgress - colorIndex;
            this.thinkingColorTemp
                .copy(this.thinkingColors[colorIndex])
                .lerp(this.thinkingColors[nextColorIndex], t);
            this.targetColor.copy(this.thinkingColorTemp);
            
            for (let i = 0; i < this.particleCount; i++) {
                const i3 = i * 3;
                const r = 16; // 稍微放大一点
                const gridTheta = this.thinkingGridTheta[i];
                const gridPhi = this.thinkingGridPhi[i];
                
                // 3. 脉冲扩散 (Breathing Pulse)
                // 从中心向外扩散的波纹
                const pulseWave = Math.sin(time * 3 - gridPhi * 4);
                const pulse = 1 + pulseWave * 0.05;
                
                // 4. 编织扭曲 (Weaving Twist)
                // 让经纬线产生交错感
                const twist = Math.sin(gridPhi * 10 + time) * 0.1;
                
                const finalTheta = gridTheta + twist + time * 0.2; // 缓慢自转
                const finalPhi = gridPhi;
                
                // 5. 转回笛卡尔坐标
                const targetX = r * pulse * Math.sin(finalPhi) * Math.sin(finalTheta);
                const targetZ = r * pulse * Math.sin(finalPhi) * Math.cos(finalTheta);
                const targetY = r * pulse * Math.cos(finalPhi);
                
                positions[i3] += (targetX - positions[i3]) * 0.05;
                positions[i3 + 1] += (targetY - positions[i3 + 1]) * 0.05;
                positions[i3 + 2] += (targetZ - positions[i3 + 2]) * 0.05;
            }
            positionUpdated = true;
        } else if (shouldUpdateParticles && this.isAiSpeaking) {
            // 说话状态（方案二）：双环空心圆
            // 内环较稳，外环随音量更明显变化
            const time = now * 0.0015;
            const energy = Math.max(0, Math.min(1, this.aiAudioLevel));
            const half = Math.floor(this.particleCount * 0.5);
            const outerBase = 19 + energy * 3.8;
            const innerBase = 12.8 + energy * 1.6;
            const outerPulse = Math.sin(time * 2.2) * 0.7;
            const innerPulse = Math.sin(time * 1.6 + 1.1) * 0.35;
            const response = 0.12 + energy * 0.18;
            
            for (let i = 0; i < this.particleCount; i++) {
                const i3 = i * 3;
                const isOuter = i < half;
                const ringCount = isOuter ? half : (this.particleCount - half);
                const idx = isOuter ? i : (i - half);
                const ratio = ringCount > 0 ? idx / ringCount : 0;
                const angle = ratio * Math.PI * 2 + (isOuter ? time * 0.14 : -time * 0.09);
                const seed = i * 0.017;
                
                const wave = Math.sin(angle * 6 + time * 2.8 + seed) * (isOuter ? 0.5 : 0.26) * (0.5 + energy * 1.15);
                const radius = (isOuter ? (outerBase + outerPulse) : (innerBase + innerPulse)) + wave;
                
                const targetX = Math.cos(angle) * radius;
                const targetY = Math.sin(angle) * radius;
                const targetZ = Math.sin(angle * 4 + time * 1.2 + seed) * (isOuter ? 0.34 : 0.2);
                
                positions[i3] += (targetX - positions[i3]) * response;
                positions[i3 + 1] += (targetY - positions[i3 + 1]) * response;
                positions[i3 + 2] += (targetZ - positions[i3 + 2]) * response;
            }
            positionUpdated = true;
        } else if (shouldUpdateParticles) {
            // 默认闲置状态：缓慢旋转的空心球体
             const time = now * 0.0005;
             
             for (let i = 0; i < this.particleCount; i++) {
                const i3 = i * 3;
                const ox = this.originalPositions[i3];
                const oy = this.originalPositions[i3 + 1];
                const oz = this.originalPositions[i3 + 2];
                
                // 呼吸效果：整体缩放
                const breath = 1 + Math.sin(time * 2) * 0.03;
                
                // 表面微动：让粒子在球面上微微游走，更有科技感
                // 通过叠加正弦波产生表面波动
                const noise = Math.sin(ox * 0.5 + time) * Math.cos(oy * 0.5 + time) * 0.5;
                
                const targetX = ox * breath + noise;
                const targetY = oy * breath + noise;
                const targetZ = oz * breath + noise;
                
                positions[i3] += (targetX - positions[i3]) * 0.05;
                positions[i3 + 1] += (targetY - positions[i3 + 1]) * 0.05;
                positions[i3 + 2] += (targetZ - positions[i3 + 2]) * 0.05;
            }
            positionUpdated = true;
        }
        
        // 颜色插值更新 (通用)
        if (shouldUpdateParticles && this.colorMode === 'ai_speaking' && this.isAiSpeaking) {
            const colors = this.particles.geometry.attributes.color.array;
            const time = now * 0.0015;
            const half = Math.floor(this.particleCount * 0.5);
            for (let i = 0; i < this.particleCount; i++) {
                const i3 = i * 3;
                const ringCount = i < half ? half : (this.particleCount - half);
                const idx = i < half ? i : (i - half);
                const ratio = ringCount > 0 ? idx / ringCount : 0;
                const mix = (Math.sin(time * 5 + ratio * Math.PI * 2 + (i < half ? 0 : 1.2)) + 1) / 2;
                this.aiColorTemp.copy(this.aiColorA).lerp(this.aiColorB, mix);
                if (i < half) {
                    // 外环更亮，强化说话反馈
                    this.aiColorTemp.multiplyScalar(1.08);
                }
                colors[i3] = this.aiColorTemp.r;
                colors[i3 + 1] = this.aiColorTemp.g;
                colors[i3 + 2] = this.aiColorTemp.b;
            }
            colorUpdated = true;
        } else if (this.colorMode !== 'recording') {
            const isDynamicUniform = this.isThinking;
            const colorDelta = this.colorDiffSquared(this.currentColor, this.targetColor);
            if (isDynamicUniform || colorDelta > 1e-7 || this.forceColorUpdate) {
                this.currentColor.lerp(this.targetColor, 0.1);
                if (this.colorDiffSquared(this.currentColor, this.targetColor) < 1e-7) {
                    this.currentColor.copy(this.targetColor);
                }
                if (
                    shouldUpdateParticles &&
                    (isDynamicUniform ||
                        this.colorDiffSquared(this.currentColor, this.lastAppliedColor) > 1e-7 ||
                        this.forceColorUpdate)
                ) {
                    const colors = this.particles.geometry.attributes.color.array;
                    for (let i = 0; i < this.particleCount; i++) {
                        const i3 = i * 3;
                        colors[i3] = this.currentColor.r;
                        colors[i3 + 1] = this.currentColor.g;
                        colors[i3 + 2] = this.currentColor.b;
                    }
                    this.lastAppliedColor.copy(this.currentColor);
                    this.forceColorUpdate = false;
                    colorUpdated = true;
                }
            }
        }

        if (positionUpdated) {
            this.particles.geometry.attributes.position.needsUpdate = true;
        }
        if (colorUpdated) {
            this.particles.geometry.attributes.color.needsUpdate = true;
        }
        
        // 整体旋转 (思考时转快点，录音时不转，其他慢点)
        if (this.isThinking) {
            this.particles.rotation.y += 0.02;
        } else if (this.isExpanded) {
            // 录音时不旋转
            this.particles.rotation.y = 0;
            this.particles.rotation.x = 0;
        } else if (this.isAiSpeaking) {
            // AI 双环需要正对镜头
            this.particles.rotation.y = 0;
            this.particles.rotation.x = 0;
        } else {
            this.particles.rotation.y += 0.002;
        }
        
        this.renderer.render(this.scene, this.camera);
    }
    
    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

window.ParticleSystem = ParticleSystem;
