/**
 * Web 音频录制
 * 使用 MediaRecorder API
 */

class AudioRecorder {
    constructor(onDataAvailable, onStop) {
        this.onDataAvailable = onDataAvailable;
        this.onStop = onStop;
        
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.stream = null;
        
        this.onAudioLevel = null;
    }
    
    setAudioLevelCallback(callback) {
        this.onAudioLevel = callback;
    }
    
    async start() {
        if (this.isRecording) return;
        
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: false,  // 关闭回声消除，避免冲突
                    noiseSuppression: false
                } 
            });
            
            // 直接用 MediaStream 创建 analyser
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(this.stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            
            // 实时分析音频级别
            const analyze = () => {
                if (!this.isRecording) return;
                
                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    sum += dataArray[i];
                }
                const avg = sum / dataArray.length / 255;
                
                if (this.onAudioLevel) {
                    this.onAudioLevel(avg);
                }
                
                requestAnimationFrame(analyze);
            };
            
            this.audioChunks = [];
            
            this.mediaRecorder = new MediaRecorder(this.stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };
            
            this.mediaRecorder.onstop = () => {
                this.handleStop();
            };
            
            this.mediaRecorder.start(100);
            this.isRecording = true;
            
            // 开始分析
            analyze();
            
            console.log('AudioRecorder: 录音开始');
        } catch (err) {
            console.error('AudioRecorder: 错误:', err);
            throw err;
        }
    }
    
    stop() {
        if (!this.isRecording || !this.mediaRecorder) return;
        
        console.log('AudioRecorder: 停止');
        this.mediaRecorder.stop();
        this.isRecording = false;
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }
    }
    
    handleStop() {
        console.log('AudioRecorder: 处理停止, 数据块:', this.audioChunks.length);
        
        if (this.audioChunks.length === 0) {
            if (this.onStop) this.onStop(null);
            return;
        }
        
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        
        if (this.onDataAvailable) {
            this.onDataAvailable(audioBlob);
        }
        
        if (this.onStop) {
            this.onStop();
        }
    }
    
    getIsRecording() {
        return this.isRecording;
    }
}

window.AudioRecorder = AudioRecorder;
