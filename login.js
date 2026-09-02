(() => {
  const signInForm = document.getElementById('signInForm');
  const signUpForm = document.getElementById('signUpForm');
  const secondary = document.getElementById('loginSecondary');
  const intro = document.getElementById('loginIntro');
  const message = document.getElementById('loginMessage');
  const card = document.querySelector('.login-card');
  let registering = false;
  const api = () => window.AldeckotSupabase?.auth;
  const show = (text, type = '') => { message.hidden = !text; message.textContent = text || ''; message.className = `login-message ${type}`; };
  const busy = value => card?.classList.toggle('is-busy', value);
  const setMode = next => {
    registering = next;
    signInForm.hidden = next;
    signUpForm.hidden = !next;
    secondary.textContent = next ? 'Já tenho uma conta' : 'Criar conta';
    intro.textContent = next ? 'Cadastre-se para solicitar acesso ao ambiente corporativo.' : 'Entre com sua conta para acessar o ambiente corporativo.';
    show('');
  };
  const destination = () => { window.location.replace('index.html'); };

  secondary.addEventListener('click', () => setMode(!registering));
  signInForm.addEventListener('submit', async event => {
    event.preventDefault(); show(''); busy(true);
    const values = Object.fromEntries(new FormData(signInForm));
    try {
      await api().signIn(values.email, values.password);
      const state = await api().state();
      if (state.profile?.status !== 'active') {
        await api().signOut();
        throw new Error(state.profile?.status === 'blocked' ? 'Sua conta está bloqueada. Procure um administrador.' : 'Sua conta ainda está aguardando aprovação.');
      }
      destination();
    } catch (error) { show(error.message || 'Não foi possível entrar.', 'error'); }
    finally { busy(false); }
  });
  signUpForm.addEventListener('submit', async event => {
    event.preventDefault(); show('');
    const values = Object.fromEntries(new FormData(signUpForm));
    if (values.password !== values.passwordConfirmation) { show('As senhas não coincidem.', 'error'); return; }
    busy(true);
    try {
      const result = await api().register(values);
      signUpForm.reset(); setMode(false);
      show(result.message || 'Solicitação enviada. Aguarde a aprovação de um administrador.', 'success');
    } catch (error) { show(error.message || 'Não foi possível enviar a solicitação.', 'error'); }
    finally { busy(false); }
  });
  async function start() {
    const requestedState = new URLSearchParams(location.search).get('state');
    if (requestedState === 'pending') show('Sua conta está aguardando aprovação de um administrador.', 'success');
    if (requestedState === 'blocked') show('Sua conta está bloqueada. Procure um administrador.', 'error');
    try { await api()?.bootstrapAdministrator?.(); } catch (error) { console.info('Administrador inicial aguardando configuração segura.', error.message); }
    try {
      const state = await api()?.state?.();
      if (state?.session && state.profile?.status === 'active') destination();
    } catch { /* a tela de login continua disponível para uma nova tentativa */ }
  }
  start();
})();
