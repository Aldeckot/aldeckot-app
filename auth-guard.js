(() => {
  const loginUrl = state => `login.html${state ? `?state=${encodeURIComponent(state)}` : ''}`;
  const shortName = name => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return parts.length > 1 ? `${parts[0]} ${parts.at(-1)}` : (parts[0] || 'Usuário');
  };
  const initials = name => String(name || 'U').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U';
  const roleName = role => role === 'admin' ? 'Administrador' : 'Usuário padrão';
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

  function renderHomeIdentity(profile) {
    if (!document.body.classList.contains('home-page') || document.querySelector('[data-auth-home-account]')) return;
    const onlineStatus = document.querySelector('.home-page .online');
    if (onlineStatus) {
      const account = document.createElement('section');
      account.className = 'auth-home-account';
      account.dataset.authHomeAccount = 'true';
      account.setAttribute('aria-label', 'Conta conectada');
      account.innerHTML = `<button class="auth-home-logout" type="button" data-auth-home-logout title="Sair da conta" aria-label="Sair da conta"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6V4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-2M3 12h11m-3-3 3 3-3 3"/></svg></button><button class="auth-home-account-profile" type="button" data-auth-home-settings title="Abrir Configurações"><span class="auth-home-avatar" aria-hidden="true">${escapeHtml(initials(profile.full_name))}</span><span class="auth-home-account-copy"><b>${escapeHtml(shortName(profile.full_name))}</b><small>${roleName(profile.role)}</small></span><svg class="auth-home-account-caret" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 5 5 5 5-5"/></svg></button>`;
      const openSettings = () => {
        if (window.AldeckotRoute?.navigate) window.AldeckotRoute.navigate('settings.html');
        else window.location.href = 'settings.html';
      };
      account.querySelector('[data-auth-home-settings]')?.addEventListener('click', openSettings);
      account.querySelector('[data-auth-home-logout]')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        if (button.disabled) return;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        try {
          await window.AldeckotSupabase?.auth?.signOut();
        } finally {
          window.location.replace(loginUrl());
        }
      });
      onlineStatus.insertAdjacentElement('afterend', account);
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
