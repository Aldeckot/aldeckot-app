(() => {
  const signInModal = document.getElementById('signInModal');
  const signUpModal = document.getElementById('signUpModal');
  const processing = document.getElementById('requestProcessing');
  const signInForm = document.getElementById('signInForm');
  const signUpForm = document.getElementById('signUpForm');
  const signInMessage = document.getElementById('signInMessage');
  const signUpMessage = document.getElementById('signUpMessage');
  const api = () => window.AldeckotSupabase?.auth;
  const message = (node, text = '', type = '') => { node.hidden = !text; node.textContent = text; node.className = `auth-message ${type}`; };
  const authenticationError = error => {
    if (window.location.protocol === 'file:' && /fetch|network/i.test(String(error?.message || ''))) {
      return 'Esta cópia local não inclui o servidor de autenticação. Para entrar, abra o site publicado.';
    }
    return error?.message || 'Não foi possível entrar.';
  };
  const setBusy = (modal, value) => modal.classList.toggle('is-busy', value);
  const showSignIn = () => { signInModal.hidden = false; signUpModal.hidden = true; processing.hidden = true; message(signInMessage); signInForm.querySelector('input')?.focus(); };
  const showSignUp = () => { signInModal.hidden = true; signUpModal.hidden = false; processing.hidden = true; message(signUpMessage); signUpForm.querySelector('input')?.focus(); };
  const showProcessing = () => { signInModal.hidden = true; signUpModal.hidden = true; processing.hidden = false; };
  const destination = () => window.location.replace('index.html');

  document.getElementById('openSignUp').addEventListener('click', showSignUp);
  document.getElementById('openSignIn').addEventListener('click', showSignIn);
  document.getElementById('backToSignIn').addEventListener('click', showSignIn);
  signInForm.addEventListener('submit', async event => {
    event.preventDefault(); message(signInMessage); setBusy(signInModal, true);
    const values = Object.fromEntries(new FormData(signInForm));
    try {
      const result = await api().signIn(values.userCode, values.password);
      if (result?.accountState === 'pending') { showProcessing(); return; }
      const state = await api().state();
      if (state.profile?.status !== 'active') {
        await api().signOut();
        if (state.profile?.status === 'pending') { showProcessing(); return; }
        throw new Error(state.profile?.status === 'blocked' ? 'Sua conta está bloqueada. Procure um administrador.' : 'Não foi possível validar sua conta.');
      }
      destination();
    } catch (error) { message(signInMessage, authenticationError(error)); }
    finally { setBusy(signInModal, false); }
  });
  signUpForm.addEventListener('submit', async event => {
    event.preventDefault(); message(signUpMessage);
    const values = Object.fromEntries(new FormData(signUpForm));
    if (values.password !== values.passwordConfirmation) { message(signUpMessage, 'As senhas não coincidem.'); return; }
    setBusy(signUpModal, true);
    try { await api().register(values); signUpForm.reset(); showProcessing(); }
    catch (error) { message(signUpMessage, error.message || 'Não foi possível enviar a solicitação.'); }
    finally { setBusy(signUpModal, false); }
  });
  async function start() {
    const requestedState = new URLSearchParams(location.search).get('state');
    if (requestedState === 'pending' || requestedState === 'blocked') {
      if (requestedState === 'blocked') { showSignIn(); message(signInMessage, 'Sua conta está bloqueada. Procure um administrador.'); }
      else showProcessing();
    }
    try { await api()?.bootstrapAdministrator?.(); } catch (error) { console.info('Administrador inicial aguardando configuração segura.', error.message); }
    try { const state = await api()?.state?.(); if (state?.session && state.profile?.status === 'active') destination(); } catch { /* O modal de entrada continua disponível. */ }
  }
  start();
})();
