(() => {
  const api = () => window.AldeckotSupplies?.backup;
  const isAdmin = () => Boolean(window.AldeckotAuth?.isAdmin);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const icon = name => ({
    backup: '<path d="M4 9h16l2 8H2l2-8Zm2-4h12l2 4H4l2-4Zm2 8h8"/>',
    download: '<path d="M12 3v11m0 0 4-4m-4 4-4-4M5 16v4h14v-4"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    warning: '<path d="M12 3 22 21H2L12 3Zm0 6v5m0 3v1"/>'
  })[name];
  const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icon(name)}</svg>`;
  const date = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const state = { settings: { automatic: false, frequency_days: 7 }, history: [], loading: false, error: '', busy: false };
  const layer = document.createElement('div');
  layer.className = 'sp-backup-layer';
  layer.hidden = true;
  layer.innerHTML = '<section class="sp-backup-dialog" role="dialog" aria-modal="true" aria-labelledby="spBackupTitle"></section>';
  document.body.append(layer);
  const dialog = layer.firstElementChild;
  let previousFocus = null;

  const message = text => {
    const node = dialog.querySelector('[data-backup-message]');
    if (node) { node.textContent = text; node.hidden = !text; }
  };
  const close = () => {
    layer.hidden = true;
    document.body.classList.remove('sp-backup-open');
    previousFocus?.focus?.();
  };
  const historyMarkup = () => state.history.length
    ? state.history.map(row => `<article class="sp-backup-history-row"><span>${svg('calendar')}<span><b>${date(row.created_at)}</b><small>${row.source === 'automatic' ? 'Automático' : 'Manual'} · Supabase</small></span></span><button type="button" data-sp-backup="download-history" data-id="${escape(row.id)}" title="Baixar esta cópia" aria-label="Baixar backup de ${date(row.created_at)}">${svg('download')}</button></article>`).join('')
    : '<p class="sp-backup-empty">Nenhuma cópia privada criada ainda.</p>';
  const render = () => {
    const latest = state.history[0];
    dialog.innerHTML = `<header class="sp-backup-head"><span class="sp-backup-head-icon">${svg('backup')}</span><div><h2 id="spBackupTitle">Sistema de Backup</h2><p>Proteção dos dados do módulo Suprimentos</p></div><button type="button" class="sp-backup-close" data-sp-backup="close" aria-label="Fechar sistema de backup">×</button></header>
      <div class="sp-backup-content"><section class="sp-backup-latest"><h3>Último backup</h3><div class="sp-backup-latest-row"><span class="sp-backup-status">${svg(latest ? 'check' : 'warning')}<span><b>${latest ? 'Cópia privada disponível' : 'Nenhuma cópia privada'}</b><small>${latest ? date(latest.created_at) : 'Crie o primeiro backup para proteger os dados.'}</small></span></span><span class="sp-backup-pill ${latest ? '' : 'empty'}">${latest ? latest.source === 'automatic' ? 'Automático' : 'Manual' : 'Pendente'}</span></div></section>
      <section><h3>Ações</h3><div class="sp-backup-actions"><button type="button" data-sp-backup="local" ${!isAdmin() || state.busy || state.error ? 'disabled' : ''}>${svg('download')}<span><b>Este computador</b><small>Baixar uma cópia JSON completa.</small></span></button><button type="button" data-sp-backup="network" ${!isAdmin() || state.busy || state.error ? 'disabled' : ''}>${svg('database')}<span><b>Supabase</b><small>Guardar uma cópia privada no banco de dados.</small></span></button></div></section>
      <div class="sp-backup-columns"><section><h3>Backup automático</h3><label class="sp-backup-switch"><input type="checkbox" data-sp-backup-auto ${state.settings.automatic ? 'checked' : ''} ${!isAdmin() || state.busy || state.error ? 'disabled' : ''}><span><b>${state.settings.automatic ? 'Ativado' : 'Desativado'}</b><small>Uma cópia é criada ao abrir o módulo quando o prazo vencer.</small></span></label><label class="sp-backup-frequency">Frequência <span>${svg('calendar')}<input type="number" min="1" max="90" step="1" value="${state.settings.frequency_days}" data-sp-backup-frequency ${!isAdmin() || state.busy || state.error ? 'disabled' : ''}> dias</span></label><small>De 1 a 90 dias, independente dos outros módulos.</small></section><section><h3>Histórico de backups</h3><div class="sp-backup-history">${historyMarkup()}</div></section></div>
      <p class="sp-backup-message" data-backup-message ${state.error ? '' : 'hidden'} role="status">${escape(state.error)}</p><p class="sp-backup-notice">${svg('warning')} As cópias incluem os registros do módulo e os caminhos das imagens. A restauração automática ainda não é oferecida porque unidades podem estar vinculadas a Inventário, Gestão TI e Controle TI.</p></div>`;
  };
  const refresh = async () => {
    [state.settings, state.history] = await Promise.all([api().settings(), api().list()]);
    state.error = '';
    if (!layer.hidden) render();
  };
  const open = async () => {
    previousFocus = document.activeElement;
    layer.hidden = false;
    document.body.classList.add('sp-backup-open');
    dialog.innerHTML = '<p class="sp-backup-loading aldeckot-inline-loading" role="status">Carregando backups de Suprimentos…</p>';
    try { await refresh(); }
    catch (error) {
      state.error = /supply_backups|supply_backup_settings|supply_backup_snapshot/i.test(error.message || '')
        ? 'Estrutura de backup indisponível. Aplique supabase/059_supply_backups.sql no Supabase.'
        : (error.message || 'Não foi possível carregar o sistema de backup.');
      render();
    }
    dialog.querySelector('[data-sp-backup="close"]')?.focus();
  };
  const download = (name, snapshot) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const automate = async () => {
    if (!isAdmin()) return;
    try {
      await refresh();
      if (!state.settings.automatic) return;
      const latest = state.history[0];
      const due = !latest || Date.now() - new Date(latest.created_at).getTime() >= state.settings.frequency_days * 86400000;
      if (due) {
        await api().create(await api().snapshot(), 'automatic');
        await refresh();
      }
    } catch (error) { console.warn('Backup automático de Suprimentos indisponível:', error); }
  };
  layer.addEventListener('click', async event => {
    if (event.target === layer) { close(); return; }
    const button = event.target.closest('[data-sp-backup]');
    if (!button) return;
    const action = button.dataset.spBackup;
    if (action === 'close') { close(); return; }
    if (state.busy) return;
    state.busy = true;
    button.disabled = true;
    button.classList.add('aldeckot-loading-button');
    button.setAttribute('aria-busy', 'true');
    message('Preparando a cópia…');
    try {
      if (action === 'local') {
        download(`aldeckot-suprimentos-backup-${new Date().toISOString().slice(0, 10)}.json`, await api().snapshot());
        message('Backup completo baixado neste computador.');
      } else if (action === 'network') {
        await api().create(await api().snapshot());
        await refresh();
        message('Backup privado criado no Supabase.');
      } else if (action === 'download-history') {
        const row = await api().get(button.dataset.id);
        download(`aldeckot-suprimentos-backup-${row.created_at.slice(0, 10)}.json`, row.snapshot);
        message('Backup do histórico baixado.');
      }
    } catch (error) { message(error.message || 'Não foi possível concluir o backup.'); }
    finally {
      state.busy = false;
      button.classList.remove('aldeckot-loading-button');
      button.removeAttribute('aria-busy');
      button.disabled = false;
    }
  });
  layer.addEventListener('change', async event => {
    const auto = event.target.matches('[data-sp-backup-auto]');
    const frequency = event.target.matches('[data-sp-backup-frequency]');
    if (!auto && !frequency) return;
    try {
      if (auto) await api().setAutomatic(event.target.checked);
      else await api().setFrequency(event.target.value);
      await refresh();
      message('Configuração salva para Suprimentos.');
    } catch (error) {
      message(error.message || 'Não foi possível salvar a configuração.');
      await refresh().catch(() => {});
    }
  });
  document.addEventListener('keydown', event => {
    if (layer.hidden) return;
    if (event.key === 'Escape') close();
    if (event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  window.AldeckotSuppliesBackup = { open };
  (window.AldeckotAuthReady || Promise.resolve()).then(automate).catch(() => {});
})();
