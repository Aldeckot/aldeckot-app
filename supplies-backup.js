(() => {
  const api = () => window.AldeckotSupplies?.backup;
  const isAdmin = () => Boolean(window.AldeckotAuth?.isAdmin);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const icon = name => ({
    backup: '<path d="M4 9h16l2 8H2l2-8Zm2-4h12l2 4H4l2-4Zm2 8h8"/>',
    download: '<path d="M12 3v11m0 0 4-4m-4 4-4-4M5 16v4h14v-4"/>',
    upload: '<path d="M12 17V6m0 0 4 4m-4-4-4 4M5 18v2h14v-2"/>',
    close: '<path d="M5 5l14 14M19 5 5 19"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    warning: '<path d="M12 3 22 21H2L12 3Zm0 6v5m0 3v1"/>'
  })[name];
  const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icon(name)}</svg>`;
  const date = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const state = { settings: { automatic: false, frequency_days: 7 }, history: [], loading: false, error: '', busy: false };
  let view = 'home';
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
    ? state.history.map(row => `<article class="sp-backup-history-row"><span class="sp-backup-history-date">${svg('calendar')}<span><b>${date(row.created_at).split(',')[0]}</b><small>${date(row.created_at).split(',')[1]?.trim() || '—'}</small></span></span><span class="sp-backup-source ${row.source === 'automatic' ? 'automatic' : ''}">${row.source === 'automatic' ? 'Automático' : 'Manual'}</span><span class="sp-backup-success">${svg('check')} Sucesso</span><button type="button" data-sp-backup="download-history" data-id="${escape(row.id)}" title="Baixar esta cópia" aria-label="Baixar backup de ${date(row.created_at)}" ${!isAdmin() || state.busy ? 'disabled' : ''}>${svg('download')}</button></article>`).join('')
    : '<p class="sp-backup-empty">Nenhuma cópia privada criada ainda.</p>';
  const render = () => {
    const latest = state.history[0];
    const unavailable = !isAdmin() || state.busy || state.error;
    dialog.innerHTML = `<div class="sp-backup-content"><header class="sp-backup-head"><span class="sp-backup-head-icon">${svg(view === 'create' ? 'download' : 'backup')}</span><div><h2 id="spBackupTitle">${view === 'create' ? 'Criar Backup' : 'Sistema de Backup'}</h2><p>${view === 'create' ? 'Escolha onde deseja guardar a cópia dos dados.' : 'Proteção dos dados do módulo Suprimentos'}</p></div><button type="button" class="sp-backup-close" data-sp-backup="close" aria-label="Fechar sistema de backup">${svg('close')}</button></header>
      ${view === 'create' ? `<div class="sp-backup-destinations"><button class="sp-backup-destination" type="button" data-sp-backup="local" ${unavailable ? 'disabled' : ''}><span>${svg('download')}</span><b>Este computador</b><small>Baixar um arquivo JSON completo para guardar localmente.</small></button><button class="sp-backup-destination network" type="button" data-sp-backup="network" ${unavailable ? 'disabled' : ''}><span>${svg('database')}</span><b>Supabase</b><small>Guardar uma cópia privada no banco de dados.</small></button></div><footer class="sp-backup-choice-footer"><button class="sp-backup-secondary" type="button" data-sp-backup="back">Voltar</button></footer>` : `<section class="sp-backup-latest"><h3>Último backup</h3><div class="sp-backup-latest-grid"><div class="sp-backup-status ${latest ? '' : 'empty'}"><span class="sp-backup-status-icon">${svg(latest ? 'check' : 'warning')}</span><span><b>${latest ? 'Backup realizado com sucesso' : 'Nenhum backup disponível'}</b><small>${latest ? latest.source === 'automatic' ? 'Backup automático' : 'Backup manual' : 'Crie o primeiro backup para proteger os dados.'}</small></span></div><div class="sp-backup-time">${svg('calendar')}<span><b>${latest ? date(latest.created_at).split(',')[0] : '—'}</b><small>${latest ? date(latest.created_at).split(',')[1]?.trim() || '—' : '—'}</small></span></div><span class="sp-backup-auto-status"><i class="${state.settings.automatic ? 'enabled' : ''}"></i><span><b>${state.settings.automatic ? 'Ativado' : 'Desativado'}</b><small>Backup automático</small></span></span></div></section>
      <section class="sp-backup-actions-section"><h3>Ações</h3><div class="sp-backup-actions"><button class="sp-backup-action-card" type="button" data-sp-backup="create" ${unavailable ? 'disabled' : ''}><span class="sp-backup-action-icon">${svg('download')}</span><span><b>Criar Backup</b><small>Criar uma cópia completa dos dados de Suprimentos.</small></span></button><button class="sp-backup-action-card restore" type="button" disabled aria-describedby="spBackupRestoreNotice"><span class="sp-backup-action-icon">${svg('upload')}</span><span><b>Restaurar Backup</b><small>Indisponível para dados vinculados a outros módulos.</small></span></button></div></section>
      <div class="sp-backup-columns"><section class="sp-backup-auto-panel"><h3>Backup automático</h3><label class="sp-backup-switch"><input type="checkbox" data-sp-backup-auto ${state.settings.automatic ? 'checked' : ''} ${unavailable ? 'disabled' : ''}><span class="sp-backup-switch-track" aria-hidden="true"><i></i></span><span><b>Backup automático</b><small>Criar automaticamente uma cópia dos dados em intervalos definidos.</small></span></label><label class="sp-backup-frequency"><span>Frequência</span><span class="sp-backup-frequency-control">${svg('calendar')}<input type="number" min="1" max="90" step="1" value="${state.settings.frequency_days}" data-sp-backup-frequency aria-label="Frequência do backup automático em dias" ${unavailable ? 'disabled' : ''}><em>dias</em></span><small>De 1 a 90 dias. A alteração é salva automaticamente.</small></label></section><section class="sp-backup-history-panel"><h3>Histórico de backups</h3><div class="sp-backup-history">${historyMarkup()}</div></section></div><footer class="sp-backup-footer"><p class="sp-backup-notice" id="spBackupRestoreNotice">${svg('warning')}<span><b>Atenção:</b> as cópias incluem os registros e caminhos das imagens. A restauração ainda não é oferecida porque unidades podem estar vinculadas a Inventário, Gestão TI e Controle TI.</span></p><button class="sp-backup-secondary" type="button" data-sp-backup="close">Fechar</button></footer>`}
      <p class="sp-backup-message" data-backup-message ${state.error ? '' : 'hidden'} role="status">${escape(state.error)}</p></div>`;
  };
  const refresh = async () => {
    [state.settings, state.history] = await Promise.all([api().settings(), api().list()]);
    state.error = '';
    if (!layer.hidden) render();
  };
  const open = async () => {
    previousFocus = document.activeElement;
    view = 'home';
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
    if (action === 'create' || action === 'back') {
      view = action === 'create' ? 'create' : 'home';
      render();
      dialog.querySelector(action === 'create' ? '.sp-backup-destination:not(:disabled)' : '[data-sp-backup="create"]')?.focus();
      return;
    }
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
