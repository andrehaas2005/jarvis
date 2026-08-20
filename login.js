// Login do JARVIS (SCRUM-56) — primeiro passo de um sistema de perfis maior.
// Mesma detecção local vs. produção do script.js (ver JARVIS_BACKEND_URL lá) — duplicada aqui
// de propósito: login.html carrega antes de qualquer coisa, sem depender do script.js do HUD.
const JARVIS_BACKEND_URL = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'http://localhost:8000'
    : 'https://jarvis-api.andre.haas.nom.br';

const form = document.getElementById('loginForm');
const usernameInput = document.getElementById('loginUsername');
const passwordInput = document.getElementById('loginPassword');
const errorEl = document.getElementById('loginError');
const button = document.getElementById('loginButton');

// Se já tem uma sessão válida guardada, pula direto pro HUD — não faz sentido mostrar login
// de novo enquanto o token (14 dias, ver app/auth.py) ainda for válido.
(async function redirectIfAlreadyLoggedIn() {
    const token = localStorage.getItem('jarvis-auth-token');
    if (!token) return;
    try {
        const response = await fetch(`${JARVIS_BACKEND_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) window.location.replace('index.html');
    } catch (error) {
        // Backend fora do ar — deixa a pessoa tentar logar normalmente quando voltar.
        console.warn('Não deu pra checar sessão existente:', error.message);
    }
})();

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.hidden = true;
    button.disabled = true;
    button.textContent = 'ENTRANDO...';

    try {
        const response = await fetch(`${JARVIS_BACKEND_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: usernameInput.value.trim(),
                password: passwordInput.value,
            }),
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.detail || 'Usuário ou senha inválidos');
        }

        const data = await response.json();
        localStorage.setItem('jarvis-auth-token', data.token);
        localStorage.setItem('jarvis-auth-user', JSON.stringify(data.user));
        window.location.replace('index.html');
    } catch (error) {
        errorEl.textContent = error.message || 'Não foi possível entrar. Tente de novo.';
        errorEl.hidden = false;
        button.disabled = false;
        button.textContent = 'LOGIN';
    }
});
