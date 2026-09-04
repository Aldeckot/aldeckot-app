(() => {
  const loginUrl = state => `login.html${state ? `?state=${encodeURIComponent(state)}` : ''}`;
  const shortName = name => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return parts.length > 1 ? `${parts[0]} ${parts.at(-1)}` : (parts[0] || 'Usuário');
  };

  function renderHomeIdentity(profile) {
    if (!document.body.classList.contains('home-page') || document.querySelector('[data-auth-home-identity]')) return;
    const main = document.querySelector('.home-reference');
    const onlineStatus = document.querySelector('.home-page .online');
    if (main) {
      const identity = document.createElement('span');
      identity.className = 'auth-home-identity';
      identity.dataset.authHomeIdentity = 'true';
      identity.textContent = shortName(profile.full_name);
      identity.setAttribute('aria-label', 'Usuário conectado');
      main.append(identity);
    }
    if (onlineStatus) {
      const button = document.createElement('button');
      button.className = 'auth-home-config';
      button.type = 'button';
      button.textContent = 'Config';
      button.title = 'Abrir Configurações';
      button.setAttribute('aria-label', 'Abrir Configurações');
      button.addEventListener('click', () => {
        if (window.AldeckotRoute?.navigate) window.AldeckotRoute.navigate('settings.html');
        else window.location.href = 'settings.html';
      });
      onlineStatus.append(button);
    }
  }

  async function protect() {
    const api = window.AldeckotSupabase;
    if (!api?.auth) throw new Error('Cliente de autenticação indisponível.');
    const state = await api.auth.state();
    if (!state.session || !state.user) {
      window.location.replace(loginUrl());
      return null;
    }
    if (!state.profile || state.profile.status !== 'active') {
      await api.auth.signOut().catch(() => {});
      window.location.replace(loginUrl(state.profile?.status || 'pending'));
      return null;
    }
    window.AldeckotAuth = state;
    document.documentElement.classList.remove('auth-pending');
    document.documentElement.classList.add('auth-ready');
    document.body.classList.add(state.isAdmin ? 'is-admin' : 'is-standard');
    document.body.dataset.authRole = state.profile.role;
    renderHomeIdentity(state.profile);
    window.addEventListener('aldeckot:realtime-change', event => {
      if (event.detail?.table !== 'profiles' || event.detail?.record?.id !== state.user.id) return;
      const next = event.detail.record;
      if (next.status !== 'active') {
        api.auth.signOut().catch(() => {}).finally(() => window.location.replace(loginUrl(next.status || 'pending')));
      } else if (next.role !== state.profile.role) {
        window.location.reload();
      }
    });
    window.dispatchEvent(new CustomEvent('aldeckot:auth-ready', { detail: state }));
    return state;
  }

  window.AldeckotAuthReady = protect().catch(error => {
    console.warn('Proteção de acesso indisponível:', error);
    document.documentElement.classList.remove('auth-pending');
    document.documentElement.classList.add('auth-error');
    document.body.innerHTML = '<main class="auth-access-error"><h1>Não foi possível validar o acesso</h1><p>Verifique a conexão com o ALDECKOT e tente novamente.</p><a href="login.html">Voltar ao login</a></main>';
    return null;
  });
})();
