/**
 * API 客户端
 * 与后端通信
 */

class APIClient {
    constructor(baseUrl = '') {
        this.baseUrl = baseUrl;
        this.ws = null;
        this.listeners = {};
    }
    
    // 发送音频进行转录
    async transcribe(audioBlob) {
        const formData = new FormData();
        formData.append('file', audioBlob, 'recording.webm');
        
        try {
            const response = await fetch(`${this.baseUrl}/api/transcribe`, {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            return data;
        } catch (err) {
            console.error('转录请求失败:', err);
            return { error: err.message };
        }
    }
    
    // 获取状态
    async getStatus() {
        try {
            const response = await fetch(`${this.baseUrl}/api/status`);
            return await response.json();
        } catch (err) {
            console.error('获取状态失败:', err);
            return { error: err.message };
        }
    }
    
    // WebSocket 连接
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket 已连接');
            this.emit('connected', {});
        };
        
        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (err) {
                console.error('解析 WebSocket 消息失败:', err);
            }
        };
        
        this.ws.onclose = () => {
            console.log('WebSocket 已断开');
            this.emit('disconnected', {});
            // 尝试重连
            setTimeout(() => this.connectWebSocket(), 3000);
        };
        
        this.ws.onerror = (err) => {
            console.error('WebSocket 错误:', err);
        };
    }
    
    handleMessage(data) {
        switch (data.type) {
            case 'transcribed':
                this.emit('transcribed', data);
                break;
            case 'ai_reply':
                this.emit('ai_reply', data);
                break;
            case 'pong':
                // 心跳响应
                break;
            default:
                console.log('未知消息类型:', data.type);
        }
    }
    
    // 事件系统
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }
    
    off(event, callback) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
    
    emit(event, data) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(callback => callback(data));
    }
    
    // 发送消息
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }
    
    // 心跳
    ping() {
        this.send({ type: 'ping' });
    }
}

// 导出
window.APIClient = APIClient;
