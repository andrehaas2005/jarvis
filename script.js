// JARVIS Interface JavaScript
class JARVISInterface {
    constructor() {
        this.chatMessages = document.getElementById('chatMessages');
        this.voiceButton = document.getElementById('voiceButton');
        this.voiceStatus = document.getElementById('voiceStatus');
        this.voiceIndicator = document.getElementById('voiceIndicator');
        this.elevenLabsWidget = null;

        this.initializeInterface();
        this.setupEventListeners();
        this.initializeElevenLabs();
        this.startSystemAnimations();
    }

    initializeInterface() {
        // Add typing indicator
        this.addTypingIndicator();
        
        // Initialize HUD animations
        this.initializeHUDAnimations();
        
        // Start dynamic data updates
        this.startDynamicUpdates();
    }

    setupEventListeners() {
        // Voice button click - now triggers ElevenLabs widget
        this.voiceButton.addEventListener('click', () => {
            this.triggerElevenLabsWidget();
        });
    }

    initializeElevenLabs() {
        // Wait for ElevenLabs widget to load
        const checkWidget = () => {
            const widget = document.querySelector('elevenlabs-convai');
            if (widget) {
                this.elevenLabsWidget = widget;
                this.updateVoiceStatus('RECONHECIMENTO DE VOZ ATIVADO');
                console.log('ElevenLabs widget loaded successfully');
            } else {
                // Retry after 500ms
                setTimeout(checkWidget, 500);
            }
        };
        
        // Start checking after a short delay to allow script to load
        setTimeout(checkWidget, 1000);
    }

    triggerElevenLabsWidget() {
        if (this.elevenLabsWidget) {
            // Update button state to show it's active
            this.updateVoiceButtonState('listening');
            this.updateVoiceStatus('ATIVANDO ELEVENLABS...');
            
            // Try multiple methods to trigger the widget
            try {
                // Method 1: Try to show the widget first
                this.elevenLabsWidget.classList.add('active');
                
                // Method 2: Look for the widget's internal microphone button
                setTimeout(() => {
                    const widgetMicButton = this.elevenLabsWidget.shadowRoot?.querySelector('button[aria-label*="microphone"], button[aria-label*="mic"], .mic-button, [data-testid*="mic"], button');
                    
                    if (widgetMicButton) {
                        widgetMicButton.click();
                        this.updateVoiceStatus('ELEVENLABS ATIVO');
                    } else {
                        // Method 3: Try to dispatch custom events
                        this.elevenLabsWidget.dispatchEvent(new CustomEvent('start-conversation'));
                        this.elevenLabsWidget.dispatchEvent(new CustomEvent('toggle-microphone'));
                        this.updateVoiceStatus('ELEVENLABS ATIVO');
                    }
                }, 100);
                
                // Method 4: Try to access the widget's API if available
                if (this.elevenLabsWidget.startConversation) {
                    this.elevenLabsWidget.startConversation();
                }
                
                // Reset button state after a delay
                setTimeout(() => {
                    this.updateVoiceButtonState('idle');
                    this.updateVoiceStatus('SISTEMA ATIVO');
                    // Hide the widget again
                    this.elevenLabsWidget.classList.remove('active');
                }, 5000);
                
            } catch (error) {
                console.error('Error triggering ElevenLabs widget:', error);
                this.updateVoiceStatus('[ERROR] FALHA ELEVENLABS');
                this.updateVoiceButtonState('idle');
                this.elevenLabsWidget.classList.remove('active');
            }
        } else {
            this.updateVoiceStatus('[WAIT] CARREGANDO...');
        }
    }

    updateVoiceButtonState(state) {
        this.voiceButton.className = `voice-button ${state}`;
    }

    updateVoiceStatus(text) {
        const statusText = this.voiceStatus.querySelector('.status-text');
        statusText.textContent = text;
    }

    // As funções addUserMessage/addJARVISResponse/addSystemMessage abaixo são primitivas de UI
    // reutilizáveis. Hoje nada as chama (o painel de chat mostra só a mensagem estática inicial) —
    // ficam reservadas para a Fase 2 do roadmap, que espelha a transcrição real do widget
    // ElevenLabs nesse painel.
    addUserMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message user-message';
        messageElement.innerHTML = `
            <div class="message-content">
                <p>[USER] ${this.escapeHtml(message)}</p>
                <span class="message-time">${this.getCurrentTime()}</span>
            </div>
        `;
        
        this.chatMessages.appendChild(messageElement);
        this.scrollToBottom();
    }

    addJARVISResponse(response) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message jarvis-message';
        messageElement.innerHTML = `
            <div class="message-content">
                <p>[JARVIS] ${this.escapeHtml(response)}</p>
                <span class="message-time">${this.getCurrentTime()}</span>
            </div>
        `;

        this.chatMessages.appendChild(messageElement);
        this.scrollToBottom();
    }

    addSystemMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message system-message';
        messageElement.innerHTML = `
            <div class="message-content">
                <p>${this.escapeHtml(message)}</p>
                <span class="message-time">${this.getCurrentTime()}</span>
            </div>
        `;
        
        this.chatMessages.appendChild(messageElement);
        this.scrollToBottom();
    }

    showTypingIndicator() {
        const typingElement = document.createElement('div');
        typingElement.className = 'message jarvis-message typing-indicator';
        typingElement.id = 'typingIndicator';
        typingElement.innerHTML = `
            <div class="message-avatar">
                <div class="avatar-ring"></div>
            </div>
            <div class="message-content">
                <div class="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;
        
        this.chatMessages.appendChild(typingElement);
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        const typingIndicator = document.getElementById('typingIndicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    addTypingIndicator() {
        const style = document.createElement('style');
        style.textContent = `
            .typing-dots {
                display: flex;
                gap: 4px;
                align-items: center;
            }
            
            .typing-dots span {
                width: 8px;
                height: 8px;
                background: var(--jarvis-blue);
                border-radius: 50%;
                animation: typingPulse 1.4s infinite ease-in-out;
            }
            
            .typing-dots span:nth-child(1) { animation-delay: -0.32s; }
            .typing-dots span:nth-child(2) { animation-delay: -0.16s; }
            
            @keyframes typingPulse {
                0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
                40% { transform: scale(1); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }


    startSystemAnimations() {
        // Add some dynamic visual effects
        this.createFloatingParticles();
        this.animateStatusDots();
    }

    initializeHUDAnimations() {
        // Animate loading bars
        this.animateLoadingBars();
        
        // Animate chart bars
        this.animateChartBars();
        
        // Animate data displays
        this.animateDataDisplays();
    }

    startDynamicUpdates() {
        // Update loading progress
        setInterval(() => {
            this.updateLoadingProgress();
        }, 2000);
        
        // Update chart data
        setInterval(() => {
            this.updateChartData();
        }, 3000);
        
        // Update log entries
        setInterval(() => {
            this.addLogEntry();
        }, 5000);
    }

    animateLoadingBars() {
        const progressBars = document.querySelectorAll('.loading-progress');
        progressBars.forEach((bar, index) => {
            const currentWidth = parseInt(bar.style.width);
            const targetWidth = Math.floor(Math.random() * 30) + 70; // 70-100%
            
            let width = currentWidth;
            const interval = setInterval(() => {
                if (width < targetWidth) {
                    width += 2;
                    bar.style.width = width + '%';
                } else {
                    clearInterval(interval);
                }
            }, 100);
        });
    }

    animateChartBars() {
        const bars = document.querySelectorAll('.bar');
        bars.forEach((bar, index) => {
            setInterval(() => {
                const newHeight = Math.floor(Math.random() * 40) + 50; // 50-90%
                bar.style.height = newHeight + '%';
            }, 2000 + (index * 500));
        });
    }

    animateDataDisplays() {
        const circles = document.querySelectorAll('.display-circle .circle-label');
        const labels = ['DY', '53', 'PH', 'KL'];
        
        setInterval(() => {
            circles.forEach((circle, index) => {
                if (Math.random() > 0.7) {
                    circle.textContent = Math.floor(Math.random() * 100).toString();
                }
            });
        }, 3000);
    }

    updateLoadingProgress() {
        const progressBars = document.querySelectorAll('.loading-progress');
        progressBars.forEach(bar => {
            const currentWidth = parseInt(bar.style.width);
            const change = (Math.random() - 0.5) * 10; // -5 to +5
            const newWidth = Math.max(20, Math.min(100, currentWidth + change));
            bar.style.width = newWidth + '%';
        });
    }

    updateChartData() {
        const bars = document.querySelectorAll('.bar');
        const labels = document.querySelectorAll('.chart-labels span');
        
        bars.forEach((bar, index) => {
            const newHeight = Math.floor(Math.random() * 50) + 30; // 30-80%
            bar.style.height = newHeight + '%';
            labels[index].textContent = newHeight;
        });
    }

    addLogEntry() {
        const logContent = document.querySelector('.log-content');
        const logEntries = [
            '[SYSTEM] JARVIS INITIALIZED',
            '[AUDIO] VOICE RECOGNITION ACTIVE',
            '[NETWORK] ELEVENLABS CONNECTED',
            '[STATUS] ALL SYSTEMS OPERATIONAL',
            '[READY] AWAITING USER INPUT',
            '[SCAN] SYSTEM INTEGRITY CHECK',
            '[DATA] PROCESSING USER QUERY',
            '[AI] NEURAL NETWORK ACTIVE',
            '[SECURITY] ENCRYPTION ENABLED',
            '[MONITOR] REAL-TIME ANALYSIS'
        ];
        
        const randomEntry = logEntries[Math.floor(Math.random() * logEntries.length)];
        const logLine = document.createElement('div');
        logLine.className = 'log-line';
        logLine.textContent = randomEntry;
        
        logContent.appendChild(logLine);
        
        // Keep only last 8 entries
        const entries = logContent.querySelectorAll('.log-line');
        if (entries.length > 8) {
            entries[0].remove();
        }
    }

    createFloatingParticles() {
        const container = document.querySelector('.floating-elements');
        
        setInterval(() => {
            const particle = document.createElement('div');
            particle.className = 'particle';
            particle.style.left = Math.random() * 100 + '%';
            particle.style.animationDuration = (Math.random() * 5 + 5) + 's';
            particle.style.animationDelay = Math.random() * 2 + 's';
            
            container.appendChild(particle);
            
            // Remove particle after animation
            setTimeout(() => {
                if (particle.parentNode) {
                    particle.parentNode.removeChild(particle);
                }
            }, 10000);
        }, 3000);
    }

    animateStatusDots() {
        const statusDots = document.querySelectorAll('.status-dot');
        statusDots.forEach(dot => {
            setInterval(() => {
                dot.style.boxShadow = `0 0 ${Math.random() * 15 + 5}px var(--jarvis-blue)`;
            }, 2000);
        });
    }

    scrollToBottom() {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    getCurrentTime() {
        return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the interface when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.jarvisInterface = new JARVISInterface();
});

// Add some keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Space bar to trigger ElevenLabs widget
    if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        if (window.jarvisInterface) {
            window.jarvisInterface.triggerElevenLabsWidget();
        }
    }
});
