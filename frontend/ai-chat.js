(function () {
    const state = {
        isSending: false
    };

    function getApiBaseUrl() {
        if (window.API_BASE_URL) return window.API_BASE_URL;
        const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
        const backendUrl = isLocalhost
            ? (window.location.protocol === 'file:' ? 'http://localhost:3000' : window.location.origin)
            : (window.ENV_BACKEND_URL || window.location.origin);
        return `${backendUrl}/api`;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char]);
    }

    function appendMessage(kind, text) {
        const log = document.getElementById('aiChatLog');
        if (!log) return;
        const item = document.createElement('div');
        item.className = `ai-chat-message ${kind}`;
        item.innerHTML = escapeHtml(text || '');
        log.appendChild(item);
        log.scrollTop = log.scrollHeight;
    }

    function setSending(isSending) {
        state.isSending = isSending;
        const button = document.getElementById('aiChatSend');
        const input = document.getElementById('aiChatInput');
        if (button) button.disabled = isSending;
        if (input) input.disabled = isSending;
    }

    async function sendAiMessage(event) {
        event.preventDefault();
        if (state.isSending) return;
        const input = document.getElementById('aiChatInput');
        const message = String(input?.value || '').trim();
        if (!message) return;

        input.value = '';
        appendMessage('user', message);
        setSending(true);

        try {
            const response = await fetch(`${getApiBaseUrl()}/ai-chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${sessionStorage.getItem('eduCore_token') || ''}`
                },
                body: JSON.stringify({ message })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result?.success) {
                throw new Error(result?.message || 'AI response failed.');
            }
            appendMessage('bot', result.answer || 'No answer returned.');
        } catch (error) {
            appendMessage('bot', error.message || 'AI chat is not available right now.');
        } finally {
            setSending(false);
            document.getElementById('aiChatInput')?.focus();
        }
    }

    function togglePanel(forceOpen = null) {
        const panel = document.getElementById('aiChatPanel');
        if (!panel) return;
        const open = forceOpen === null ? !panel.classList.contains('open') : Boolean(forceOpen);
        panel.classList.toggle('open', open);
        document.getElementById('aiChatLauncher')?.setAttribute('aria-expanded', String(open));
        if (open) window.setTimeout(() => document.getElementById('aiChatInput')?.focus(), 50);
    }

    function mountAiChat() {
        if (document.getElementById('aiChatPanel')) return;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <button type="button" class="ai-chat-launcher" id="aiChatLauncher" aria-label="Open AI chat" aria-expanded="false">
                <i data-lucide="bot"></i>
            </button>
            <section class="ai-chat-panel" id="aiChatPanel" aria-label="AI chat assistant">
                <div class="ai-chat-head">
                    <div>
                        <strong>AI Assistant</strong>
                        <span>Ask about students, teachers, fees, results, or portal help.</span>
                    </div>
                    <button type="button" class="ai-chat-close" id="aiChatClose" aria-label="Close AI chat">
                        <i data-lucide="x"></i>
                    </button>
                </div>
                <div class="ai-chat-log" id="aiChatLog">
                    <div class="ai-chat-message bot">Assalam o Alaikum. Aap school system ke data ya portal ke kisi kaam ke bare me pooch sakte hain.</div>
                </div>
                <form class="ai-chat-form" id="aiChatForm">
                    <input class="ai-chat-input" id="aiChatInput" type="text" autocomplete="off" placeholder="Type your question...">
                    <button class="ai-chat-send" id="aiChatSend" type="submit" aria-label="Send message">
                        <i data-lucide="send"></i>
                    </button>
                </form>
            </section>
        `;
        document.body.appendChild(wrapper);
        document.getElementById('aiChatLauncher')?.addEventListener('click', () => togglePanel());
        document.getElementById('aiChatClose')?.addEventListener('click', () => togglePanel(false));
        document.getElementById('aiChatForm')?.addEventListener('submit', sendAiMessage);
        if (window.lucide) window.lucide.createIcons();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountAiChat);
    } else {
        mountAiChat();
    }
})();
