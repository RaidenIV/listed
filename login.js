/* login.js — auth page logic for Listed.
   Handles sign in, account creation, the "check your email" state,
   the post-verification success state, and resending links. */

(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  let mode = 'login'; // 'login' | 'signup'

  const els = {
    formView: $('formView'),
    checkState: $('checkState'),
    verifiedState: $('verifiedState'),
    message: $('message'),
    tabLogin: $('tabLogin'),
    tabSignup: $('tabSignup'),
    email: $('email'),
    password: $('password'),
    pwHint: $('pwHint'),
    submitBtn: $('submitBtn'),
    togglePw: $('togglePw'),
    sentTo: $('sentTo'),
    resendBtn: $('resendBtn'),
    goToApp: $('goToApp'),
    verifiedMsg: $('verifiedMsg'),
    rememberRow: $('rememberRow'),
    rememberMe: $('rememberMe'),
  };

  async function api(path, body) {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  function showMessage(text, kind = 'info') {
    els.message.className = `msg ${kind}`;
    els.message.innerHTML = text;
    els.message.hidden = false;
  }
  function hideMessage() { els.message.hidden = true; }

  function setMode(next) {
    mode = next;
    const signup = mode === 'signup';
    els.tabLogin.classList.toggle('active', !signup);
    els.tabSignup.classList.toggle('active', signup);
    els.submitBtn.textContent = signup ? 'Create account' : 'Sign in';
    els.password.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
    els.pwHint.hidden = !signup;
    els.rememberRow.classList.toggle('visible', !signup);
    hideMessage();
  }

  function showView(view) {
    els.formView.hidden = view !== 'form';
    els.checkState.hidden = view !== 'check';
    els.verifiedState.hidden = view !== 'verified';
  }

  // ── Tabs ──
  els.tabLogin.addEventListener('click', () => setMode('login'));
  els.tabSignup.addEventListener('click', () => setMode('signup'));

  // ── Show/hide password ──
  els.togglePw.addEventListener('click', () => {
    const showing = els.password.type === 'text';
    els.password.type = showing ? 'password' : 'text';
    els.togglePw.innerHTML = `<i class="ti ti-eye${showing ? '' : '-off'}"></i>`;
  });

  // ── Submit (login or signup) ──
  async function submit() {
    const email = els.email.value.trim();
    const password = els.password.value;
    if (!email || !password) { showMessage('Enter your email and password.', 'error'); return; }
    if (mode === 'signup' && password.length < 8) {
      showMessage('Password must be at least 8 characters.', 'error'); return;
    }

    els.submitBtn.disabled = true;
    els.submitBtn.textContent = mode === 'signup' ? 'Creating…' : 'Signing in…';
    hideMessage();

    try {
      if (mode === 'signup') {
        const { ok, data } = await api('/api/auth/signup', { email, password });
        if (!ok) { showMessage(data.error || 'Could not create your account.', 'error'); return; }
        els.sentTo.textContent = email;
        showView('check');
        if (data.devVerifyUrl) {
          showMessage(`Dev mode (no mailer configured): <a href="${data.devVerifyUrl}">activate your account</a>.`, 'info');
        }
      } else {
        const { ok, status, data } = await api('/api/auth/login', { email, password, remember: !!els.rememberMe.checked });
        if (ok) { location.href = '/'; return; }
        if (status === 403 && data.needsVerification) {
          els.sentTo.textContent = email;
          showView('check');
          showMessage('This account still needs to be verified. We can resend the link.', 'info');
          return;
        }
        showMessage(data.error || 'Could not sign you in.', 'error');
      }
    } catch {
      showMessage('Network error. Check your connection and try again.', 'error');
    } finally {
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    }
  }

  els.submitBtn.addEventListener('click', submit);
  els.password.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  els.email.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  // ── Resend verification ──
  els.resendBtn.addEventListener('click', async () => {
    const email = els.sentTo.textContent || els.email.value.trim();
    if (!email) return;
    els.resendBtn.disabled = true;
    els.resendBtn.textContent = 'Sending…';
    try {
      const { data } = await api('/api/auth/resend', { email });
      if (data.devVerifyUrl) {
        showMessage(`Dev mode: <a href="${data.devVerifyUrl}">activate your account</a>.`, 'info');
      } else {
        showMessage('A new link is on its way.', 'success');
      }
    } finally {
      els.resendBtn.disabled = false;
      els.resendBtn.textContent = 'Resend link';
    }
  });

  els.goToApp.addEventListener('click', () => { location.href = '/'; });

  // ── Initial state from URL / session ──
  async function init() {
    if (params.get('verified') === '1') {
      showView('verified');
      const { data } = await api('/api/auth/me');
      els.verifiedMsg.textContent = data.user
        ? `You're all set and signed in as ${data.user.email}.`
        : 'Your account is active. You can sign in now.';
      return;
    }
    if (params.get('verify') === 'expired') {
      showView('form');
      setMode('login');
      showMessage('That verification link was invalid or expired. Sign in to get a new one sent.', 'error');
      return;
    }

    // Already signed in? Offer to continue.
    const { data } = await api('/api/auth/me');
    if (data.user) {
      showView('verified');
      els.verifiedState.querySelector('h2').textContent = 'You\u2019re signed in';
      els.verifiedMsg.textContent = `Signed in as ${data.user.email}.`;
      return;
    }

    showView('form');
    setMode('login');
  }

  init();
})();
