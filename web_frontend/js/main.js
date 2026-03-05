/**
 * Yuzhua Web 主程序
 * 支持多轮对话
 */

let particleSystem;
let handTracker;
let audioRecorder;
let apiClient;

const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const gestureHintEl = document.getElementById('gesture-hint');
const cameraVideoEl = document.getElementById("camera-video");
const cameraPreviewEl = document.querySelector('.camera-preview');
const latestMessageEl = document.getElementById("latest-message");

let isRecording = false;
let recordingTooShort = false;
let recordingStartTime = 0;
let typewriterIntervals = [];
let speechSynthesis = window.speechSynthesis;
let isSpeaking = false;
let currentTtsAudio = null;
let ttsAudioContext = null;
let ttsAnalyser = null;
let ttsRaf = null;
const DEBUG = false;
const PERF_STORAGE_KEY = "yuzhua_perf_mode";
const PERF_MODES = {
    high: { label: "高", particleCount: 3500, pixelRatioCap: 2, antialias: true, backgroundMotion: "full" },
    balanced: { label: "中", particleCount: 2600, pixelRatioCap: 1.5, antialias: true, backgroundMotion: "lite" },
    low: { label: "低", particleCount: 1800, pixelRatioCap: 1.2, antialias: false, backgroundMotion: "off" }
};

function debugLog(...args) {
    if (DEBUG) console.log(...args);
}

// 过滤 Markdown 和 Emoji
function filterContent(text) {
    if (!text) return "";
    // 过滤 Markdown 符号
    text = text.replace(/\*\*/g, "");
    text = text.replace(/\*/g, "");
    text = text.replace(/`/g, "");
    text = text.replace(/---/g, "");
    text = text.replace(/#/g, "");
    // 过滤 emoji
    text = text.replace(/[\u{1F300}-\u{1F9FF}]/gu, "");
    text = text.replace(/[\u{2600}-\u{26FF}]/gu, "");
    return text.trim();
}

// 过滤 Markdown 和 Emoji

async function init() {
    debugLog('初始化 Yuzhua Web...');
    
    // 创建状态栏
    createStatusBar();
    
    particleSystem = new ParticleSystem('particle-canvas');
    particleSystem.setExpanded(false);
    
    apiClient = new APIClient();
    
    apiClient.on('transcribed', (data) => {
        updateVadStatus(data.vad === true);
        debugLog('📝 收到转录结果:', data.text);
        addTranscript(data.text);
    });
    
    apiClient.on('ai_reply', (data) => {
        debugLog('🤖 收到AI回复:', data.text);
        addReply(data.text);
    });
    
    apiClient.on('connected', () => {
        debugLog('🔗 WebSocket 已连接');
        updateServerStatus('gateway', true);
        setStatus('ready', '已就绪');
    });
    
    apiClient.on('disconnected', () => {
        updateServerStatus('gateway', false);
    });
    
    apiClient.connectWebSocket();

    // 定期检查后端状态
    setInterval(checkBackendStatus, 5000);
    checkBackendStatus();

    // 手势初始化不阻塞后端连接检测
    const videoEl = document.getElementById('video');
    handTracker = new HandTracker(videoEl, cameraVideoEl, handleGestureChange);
    handTracker.init().catch((err) => {
        console.warn('手势初始化失败:', err);
    });
    
    audioRecorder = new AudioRecorder(handleAudioData, handleRecordingStop);
    
    audioRecorder.setAudioLevelCallback((level) => {
        if (particleSystem) {
            particleSystem.setAudioLevel(level);
        }
    });
}

function getPerfModeFromEnv() {
    const url = new URL(window.location.href);
    const modeFromUrl = url.searchParams.get("perf");
    if (modeFromUrl && PERF_MODES[modeFromUrl]) return modeFromUrl;
    const modeFromStorage = localStorage.getItem(PERF_STORAGE_KEY);
    if (modeFromStorage && PERF_MODES[modeFromStorage]) return modeFromStorage;
    return "high";
}

function applyPerfMode(mode) {
    const safeMode = PERF_MODES[mode] ? mode : "high";
    const config = PERF_MODES[safeMode];
    window.__APP_PERF__ = {
        mode: safeMode,
        particleCount: config.particleCount,
        pixelRatioCap: config.pixelRatioCap,
        antialias: config.antialias
    };
    document.documentElement.setAttribute("data-perf-mode", safeMode);
    localStorage.setItem(PERF_STORAGE_KEY, safeMode);
}

async function clearAppCaches() {
    try {
        if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((key) => caches.delete(key)));
        }
    } catch (err) {
        console.warn("清理 CacheStorage 失败:", err);
    }
}

async function switchPerfMode(nextMode) {
    if (!PERF_MODES[nextMode]) return;
    await clearAppCaches();

    const preserveMode = nextMode;
    try {
        sessionStorage.clear();
        localStorage.clear();
    } catch (err) {
        console.warn("清理本地存储失败:", err);
    }
    localStorage.setItem(PERF_STORAGE_KEY, preserveMode);

    const url = new URL(window.location.href);
    url.searchParams.set("perf", preserveMode);
    url.searchParams.set("_r", String(Date.now()));
    window.location.replace(url.toString());
}

// 创建状态栏
function createStatusBar() {
    const statusBar = document.createElement('div');
    statusBar.className = 'status-bar';
    const currentMode = getPerfModeFromEnv();
    statusBar.innerHTML = `
        <div id="status-gateway" class="status-badge disconnected">🔴 网关</div>
        <div id="status-server" class="status-badge disconnected">🔴 后端</div>
        <div id="status-vad" class="status-badge">⚪ VAD</div>
        <label class="perf-switch" for="perf-mode" title="性能模式">
            <select id="perf-mode" class="perf-select">
                <option value="high" ${currentMode === "high" ? "selected" : ""}>性能: 高</option>
                <option value="balanced" ${currentMode === "balanced" ? "selected" : ""}>性能: 中</option>
                <option value="low" ${currentMode === "low" ? "selected" : ""}>性能: 低</option>
            </select>
        </label>
    `;
    document.body.appendChild(statusBar);

    const perfSelectEl = document.getElementById("perf-mode");
    if (perfSelectEl) {
        perfSelectEl.addEventListener("change", async (e) => {
            const selected = e.target.value;
            if (!PERF_MODES[selected]) return;
            perfSelectEl.disabled = true;
            await switchPerfMode(selected);
        });
    }
}

// 更新状态显示
function updateServerStatus(type, connected) {
    const el = document.getElementById(`status-${type}`);
    if (el) {
        el.className = connected ? 'status-badge connected' : 'status-badge disconnected';
        el.textContent = connected ? `🟢 ${type === 'gateway' ? '网关' : '后端'}` : `🔴 ${type === 'gateway' ? '网关' : '后端'}`;
    }
}

// 检查后端状态
async function checkBackendStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        
        if (data.transcriber === 'ready') {
            updateServerStatus('server', true);
        } else {
            updateServerStatus('server', false);
        }
    } catch (e) {
        updateServerStatus('server', false);
    }
}

function handleGestureChange(isHandOpen, gestureType) {
    debugLog('👋 手势变化:', gestureType);
    
    if (gestureType === 'hand_open') {
        setCameraPreviewState(true);
        gestureHintEl.textContent = '🖐️ 手掌打开 - 录音中';
        gestureHintEl.className = 'gesture-hint hand-open';
        
        debugLog("设置粒子为录音状态");
        particleSystem.setExpanded(true);
        
        if (!isRecording) {
            startRecording();
        }
    } else if (gestureType === 'hand_closed') {
        setCameraPreviewState(true);
        gestureHintEl.textContent = '✋ 手掌未打开';
        gestureHintEl.className = 'gesture-hint';
        
        particleSystem.setExpanded(false);
        
        if (isRecording) {
            stopRecording();
        }
    } else if (gestureType === 'no_hand') {
        setCameraPreviewState(false);
        gestureHintEl.textContent = '👋 等待手势...';
        gestureHintEl.className = 'gesture-hint';
        
        particleSystem.setExpanded(false);
        
        if (isRecording) {
            stopRecording();
        }
    } else {
        setCameraPreviewState(false);
        gestureHintEl.textContent = '👋 等待手势...';
        gestureHintEl.className = 'gesture-hint';
    }
}

function setCameraPreviewState(hasHand) {
    if (!cameraPreviewEl) return;
    cameraPreviewEl.classList.toggle('no-hand', !hasHand);
}

function startRecording() {
    debugLog('🎙️ 开始录音');
    stopTts();
    isRecording = true;
    recordingStartTime = Date.now();
    setStatus('recording', '🎙️ 录音中...');
    
    audioRecorder.start().catch(err => {
        console.error('❌ 录音失败:', err);
        setStatus('error', '录音失败');
        isRecording = false;
        particleSystem.setExpanded(false);
    });
}

function stopRecording() {
    debugLog('⏹️ 停止录音');
    isRecording = false;
    
    // 检查录音时长
    const duration = (Date.now() - recordingStartTime) / 1000;
    debugLog('录音时长:', duration.toFixed(1), '秒');
    
    if (duration < 1) {
        recordingTooShort = true;
        debugLog("语音过短，不转写");
        setStatus('idle', '语音过短');
        particleSystem.setExpanded(false);
        audioRecorder.stop();
        return;
    }
    
    setStatus('thinking', '🤔 处理中...');
    particleSystem.setExpanded(false);
    audioRecorder.stop();
}

function handleAudioData(audioBlob) {
    if (recordingTooShort) {
        debugLog("语音过短，忽略");
        recordingTooShort = false;
        return;
    }
    if (!audioBlob) {
        console.warn('⚠️ 无录音数据');
        return;
    }
    
    debugLog('📤 发送音频, 大小:', audioBlob.size, 'bytes');
    
    apiClient.transcribe(audioBlob).then(response => {
        debugLog('📥 转录响应:', response);
        if (response.error) {
            setStatus('error', '转录失败: ' + response.error);
        } else if (!response.text || response.text.trim() === '') {
            setStatus('idle', '未识别到说话');
        }
    }).catch(err => {
        console.error('❌ 请求失败:', err);
        setStatus('error', '请求失败');
    });
}

function handleRecordingStop() {
    debugLog('✅ 录音已停止');
}

function addTranscript(text) {
    showLatestMessage(text, "user");
    if (!text) return;
    
    const msgEl = document.createElement('div');
    msgEl.className = 'message transcript';
    msgEl.textContent = '👤 你说: ' + text;
    messagesEl.appendChild(msgEl);
    scrollMessagesToBottom();
}

function addReply(text) {
    text = filterContent(text);
    speakText(text);
    showLatestMessage(text, "ai");
    setStatus('ready', '已就绪');
    if (!text) return;
    
    const msgEl = document.createElement('div');
    msgEl.className = 'message reply';
    msgEl.innerHTML = '🐾 Yuzhua: <span class="cursor"></span>';
    messagesEl.appendChild(msgEl);
    scrollMessagesToBottom();
    
    particleSystem.setColor(0x9b59b6);
    particleSystem.setExpandedForAI(true);
    
    let index = 0;
    const speed = 30;
    
    const interval = setInterval(() => {
        if (index < text.length) {
            msgEl.innerHTML = '🐾 Yuzhua: ' + text.substring(0, index + 1) + '<span class="cursor"></span>';
            index++;
            scrollMessagesToBottom();
        } else {
            clearInterval(interval);
            msgEl.innerHTML = '🐾 Yuzhua: ' + text;
            scrollMessagesToBottom();
            
            setStatus('ready', '已就绪');
        }
    }, speed);
    
    typewriterIntervals.push(interval);
}

function speakText(text) {
    if (!text || isSpeaking) return;
    
    debugLog("[TTS] 调用 Edge TTS...");
    
    fetch("/api/tts", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ text: text, voice: "zh-CN-XiaoxiaoNeural" })
    })
    .then(res => res.json())
    .then(data => {
        if (data.audio) {
            debugLog("[TTS] 收到音频，播放中...");
            const audioData = atob(data.audio);
            const arrayBuffer = new ArrayBuffer(audioData.length);
            const uint8Array = new Uint8Array(arrayBuffer);
            for (let i = 0; i < audioData.length; i++) {
                uint8Array[i] = audioData.charCodeAt(i);
            }
            const blob = new Blob([uint8Array], { type: "audio/mp3" });
            if (currentTtsAudio) {
                stopTts();
            }
            const audioUrl = URL.createObjectURL(blob);
            const audio = new Audio(audioUrl);
            currentTtsAudio = audio;
            if (particleSystem) {
                particleSystem.setAiSpeaking(true);
                particleSystem.setColor(0x9b59b6);
            }
            ttsAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            ttsAnalyser = ttsAudioContext.createAnalyser();
            ttsAnalyser.fftSize = 256;
            const source = ttsAudioContext.createMediaElementSource(audio);
            source.connect(ttsAnalyser);
            ttsAnalyser.connect(ttsAudioContext.destination);
            const dataArray = new Uint8Array(ttsAnalyser.frequencyBinCount);
            const timeDomainArray = new Uint8Array(ttsAnalyser.fftSize);
            let smoothedLevel = 0;
            
            isSpeaking = true;
            audio.onended = () => {
                isSpeaking = false;
                URL.revokeObjectURL(audioUrl);
                currentTtsAudio = null;
                if (ttsRaf) cancelAnimationFrame(ttsRaf);
                if (ttsAudioContext) ttsAudioContext.close();
                ttsAudioContext = null;
                ttsAnalyser = null;
                ttsRaf = null;
                if (particleSystem) {
                    particleSystem.setAiSpeaking(false);
                    particleSystem.setExpandedForAI(false);
                }
            };
            audio.onerror = () => {
                isSpeaking = false;
                URL.revokeObjectURL(audioUrl);
                currentTtsAudio = null;
                if (ttsRaf) cancelAnimationFrame(ttsRaf);
                if (ttsAudioContext) ttsAudioContext.close();
                ttsAudioContext = null;
                ttsAnalyser = null;
                ttsRaf = null;
                if (particleSystem) {
                    particleSystem.setAiSpeaking(false);
                    particleSystem.setExpandedForAI(false);
                }
                console.error("[TTS] 播放失败");
            };
            
            audio.play().catch(err => {
                isSpeaking = false;
                URL.revokeObjectURL(audioUrl);
                currentTtsAudio = null;
                if (ttsRaf) cancelAnimationFrame(ttsRaf);
                if (ttsAudioContext) ttsAudioContext.close();
                ttsAudioContext = null;
                ttsAnalyser = null;
                ttsRaf = null;
                if (particleSystem) {
                    particleSystem.setAiSpeaking(false);
                    particleSystem.setExpandedForAI(false);
                }
                console.error("[TTS] 播放错误:", err);
            });
            ttsAudioContext.resume().then(() => {
                const updateLevel = () => {
                    if (!currentTtsAudio || currentTtsAudio.paused || !ttsAnalyser) return;
                    ttsAnalyser.getByteFrequencyData(dataArray);
                    ttsAnalyser.getByteTimeDomainData(timeDomainArray);

                    let sum = 0;
                    let peak = 0;
                    for (let i = 0; i < dataArray.length; i++) {
                        const v = dataArray[i];
                        sum += v;
                        if (v > peak) peak = v;
                    }

                    let squareSum = 0;
                    for (let i = 0; i < timeDomainArray.length; i++) {
                        const centered = (timeDomainArray[i] - 128) / 128;
                        squareSum += centered * centered;
                    }

                    const avg = sum / dataArray.length / 255;
                    const peakNorm = peak / 255;
                    const rms = Math.sqrt(squareSum / timeDomainArray.length);
                    const instantLevel = Math.min(1, avg * 0.35 + peakNorm * 0.45 + rms * 0.9);

                    // 快速抬升、较慢回落，让“说话波动”更明显
                    if (instantLevel > smoothedLevel) {
                        smoothedLevel = instantLevel;
                    } else {
                        smoothedLevel = smoothedLevel * 0.75 + instantLevel * 0.25;
                    }

                    if (particleSystem) {
                        particleSystem.setAiAudioLevel(smoothedLevel);
                    }
                    ttsRaf = requestAnimationFrame(updateLevel);
                };
                updateLevel();
            });
        } else {
            console.error("[TTS] 失败:", data.error);
        }
    })
    .catch(err => console.error("[TTS] 请求错误:", err));
}

function stopTts() {
    if (currentTtsAudio) {
        currentTtsAudio.pause();
        currentTtsAudio.currentTime = 0;
        currentTtsAudio.src = "";
        currentTtsAudio = null;
    }
    if (ttsRaf) cancelAnimationFrame(ttsRaf);
    if (ttsAudioContext) ttsAudioContext.close();
    ttsAudioContext = null;
    ttsAnalyser = null;
    ttsRaf = null;
    if (particleSystem) {
        particleSystem.setAiSpeaking(false);
        particleSystem.setExpandedForAI(false);
    }
    isSpeaking = false;
}

function showLatestMessage(text, type) {
    if (!text) return;
    
    const bubble = document.createElement("div");
    bubble.className = "bubble " + type;
    latestMessageEl.innerHTML = "";
    latestMessageEl.appendChild(bubble);
    
    if (type === "ai") {
        const prefix = "🐾 ";
        let index = 0;
        const interval = setInterval(() => {
            if (index < text.length) {
                bubble.textContent = prefix + text.substring(0, index + 1);
                index++;
            } else {
                clearInterval(interval);
                bubble.textContent = prefix + text;
            }
        }, 20);
        typewriterIntervals.push(interval);
    } else {
        bubble.textContent = "👤 " + text;
    }
}

function scrollMessagesToBottom() {
    if (!messagesEl) return;
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setStatus(state, text) {
    statusEl.className = 'status ' + state;
    statusEl.textContent = text;
    if (particleSystem) {
        particleSystem.setThinking(state === 'thinking');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const mode = getPerfModeFromEnv();
    applyPerfMode(mode);
    init();
});

window.addEventListener('beforeunload', () => {
    if (handTracker) handTracker.stop();
    if (audioRecorder && audioRecorder.isRecording) audioRecorder.stop();
    typewriterIntervals.forEach(interval => clearInterval(interval));
});

function updateVadStatus(passed) {
    const vadEl = document.getElementById("status-vad");
    if (vadEl) {
        vadEl.textContent = passed ? "🟢 VAD PASS" : "🔴 VAD FAIL";
        vadEl.className = passed ? "status-badge connected" : "status-badge disconnected";
    }
}
