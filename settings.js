(() => {
  const content = document.getElementById('settingsContent');
  const modal = document.getElementById('settingsModal');
  const tabs = [...document.querySelectorAll('[data-settings-tab]')];
  const avatar = document.getElementById('settingsAvatar');
  const search = document.getElementById('settingsSearch');
  const themeSwitch = document.getElementById('themeSwitch');
  let state; let activeSection = 'general'; let usersData = { users: [], audit: [] };

  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const api = () => window.AldeckotSupabase.auth;
  const date = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const roleName = value => value === 'admin' ? 'Administrador' : 'Padrão';
  const statusName = value => ({ active: 'Ativo', pending: 'Pendente', blocked: 'Bloqueado' })[value] || value;
  const notice = (text, kind = '') => `<p class="settings-status ${kind}">${escape(text)}</p>`;
  const initials = name => String(name || 'AD').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'AD';
  const panel = (title, description, body, extra = '') => `<section class="settings-panel-card ${extra}"><header class="panel-heading"><div><h2>${title}</h2>${description ? `<p>${description}</p>` : ''}</div></header>${body}</section>`;

  function selectTab(name) {
    activeSection = name;
    tabs.forEach(button => button.classList.toggle('active', button.dataset.settingsTab === name));
  }

  function option(icon, title, description, target, status = '') {
    const side = status ? `<span class="option-status ${status.kind || ''}">${status.text}</span>` : '<span class="option-arrow">›</span>';
    return `<button class="settings-option is-button" type="button" data-open-section="${target}"><span class="option-icon">${icon}</span><span class="option-copy"><b>${title}</b><span>${description}</span></span>${side}</button>`;
  }

  function bindOpeners() {
    content.querySelectorAll('[data-open-section]').forEach(button => button.addEventListener('click', () => renderSection(button.dataset.openSection)));
  }

  function updateMetrics() {
    const active = (usersData.users || []).filter(user => user.status === 'active').length;
    const pending = (usersData.users || []).filter(user => user.status === 'pending').length;
    document.getElementById('activeUsersMetric').textContent = String(active || (state?.profile?.status === 'active' ? 1 : 0));
    document.getElementById('activeUsersHint').textContent = pending ? `${pending} solicitação(ões) pendente(s)` : 'Contas autorizadas no sistema';
  }

  async function refreshUsersData() {
    if (!state?.isAdmin) {
      usersData = { users: state?.profile ? [state.profile] : [], audit: [] };
      updateMetrics();
      return usersData;
    }
    usersData = await api().listUsers();
    updateMetrics();
    return usersData;
  }

  function showGeneral() {
    selectTab('general');
    const profile = state.profile;
    content.innerHTML = `<div class="settings-layout">
      ${panel('Visão geral', 'Informações centrais da conta e do ambiente ALDECKOT.', `<div class="panel-body"><div class="settings-detail-grid"><div class="settings-detail"><span>Conta conectada</span><b>${escape(profile.full_name)}</b></div><div class="settings-detail"><span>Perfil de acesso</span><b>${roleName(profile.role)}</b></div><div class="settings-detail"><span>Estado da conta</span><b>${statusName(profile.status)}</b></div><div class="settings-detail"><span>Dados compartilhados</span><b>Sincronização central ativa</b></div></div></div>`)}
      ${panel('Segurança e acesso', 'Controles pessoais e administrativos do ambiente.', `<div class="settings-option-list">${option('♢', 'Credenciais da conta', 'Nome, código de usuário e senha do usuário conectado.', 'security', { text: 'Seguro' })}${state.isAdmin ? option('♧', 'Usuários e permissões', 'Aprovação de acessos, perfis e bloqueios.', 'users', { text: 'Admin', kind: 'info' }) : ''}${option('▤', 'Auditoria do sistema', 'Registros administrativos e ações recentes.', 'audit')}</div>`)}
      ${panel('Personalização', 'A experiência visual acompanha o tema escolhido no ALDECKOT.', `<div class="settings-option-list">${option('◉', 'Aparência do sistema', 'Tema claro ou escuro com o mesmo padrão visual.', 'appearance')}${option('♧', 'Notificações', 'Resumo dos avisos operacionais da plataforma.', 'notifications')}</div>`)}
      ${panel('Operação e dados', 'Conexões e recursos já utilizados pelos módulos.', `<div class="settings-option-list">${option('⌘', 'Integrações', 'Conexão corporativa com a base de dados.', 'integrations', { text: 'Conectado', kind: 'info' })}${option('↥', 'Backup', 'Visão geral das cópias gerenciadas por módulo.', 'backup')}</div>`)}
    </div>`;
    bindOpeners();
  }

  function showSecurity(message = '', kind = '') {
    selectTab('security');
    const profile = state.profile;
    content.innerHTML = `<div class="settings-layout"><section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Segurança e acesso</h2><p>Atualize sua identificação, código de usuário ou senha. A senha nunca é exibida nem registrada no histórico.</p></div><span class="option-status">Conta protegida</span></header><div class="panel-body">${message ? notice(message, kind) : ''}<form id="accountForm" class="settings-form"><label><span>Nome de usuário</span><input name="fullName" required minlength="3" value="${escape(profile.full_name)}"></label><label><span>Código de usuário</span><input name="userCode" inputmode="numeric" required minlength="4" maxlength="12" pattern="[0-9]+" autocomplete="username" value="${escape(profile.user_code)}"></label><label><span>Nova senha</span><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Deixe em branco para manter a atual"></label><button class="settings-save" type="submit">Salvar alterações de segurança</button></form></div></section>${panel('Políticas da conta', 'Proteções aplicadas ao acesso atual.', `<div class="settings-option-list"><div class="settings-option"><span class="option-icon">♢</span><span class="option-copy"><b>Sessão autenticada</b><span>O acesso é validado antes de carregar os dados do sistema.</span></span><span class="option-status">Ativa</span></div><div class="settings-option"><span class="option-icon">◌</span><span class="option-copy"><b>Permissões por perfil</b><span>${state.isAdmin ? 'Sua conta possui administração integral.' : 'Sua conta possui as permissões atribuídas pelo administrador.'}</span></span></div></div>`)}</div>`;
    document.getElementById('accountForm').addEventListener('submit', async event => {
      event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button'); button.disabled = true;
      try {
        const result = await api().updateOwnAccount(Object.fromEntries(new FormData(form)));
        state.profile = { ...state.profile, ...result.profile };
        avatar.textContent = initials(state.profile.full_name);
        showSecurity('Dados de segurança atualizados.', 'success');
      } catch (error) { showSecurity(error.message || 'Não foi possível atualizar sua conta.', 'error'); }
    });
  }

  async function showUsers(message = '', kind = '') {
    if (!state.isAdmin) return showGeneral();
    selectTab('users');
    content.innerHTML = `<section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Usuários e Permissões</h2><p>Carregando contas, permissões e histórico administrativo…</p></div></header></section>`;
    try { await refreshUsersData(); } catch (error) { content.innerHTML = `<section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Usuários e Permissões</h2></div></header><div class="panel-body">${notice(error.message || 'Não foi possível carregar os usuários.', 'error')}</div></section>`; return; }
    const userRows = (usersData.users || []).map(user => `<tr><td><b>${escape(user.full_name)}</b><br><small>${escape(user.user_code)}</small></td><td><span class="role-tag ${escape(user.role)}">${roleName(user.role)}</span></td><td><span class="account-tag ${escape(user.status)}">${statusName(user.status)}</span></td><td>${date(user.created_at)}</td><td>${user.status === 'pending' ? `<button class="settings-action approve" data-user-approve="${user.id}">Aprovar</button> ` : ''}<button class="settings-action" data-user-edit="${user.id}">Editar</button></td></tr>`).join('') || '<tr><td colspan="5">Nenhuma conta cadastrada.</td></tr>';
    const auditRows = renderAuditRows((usersData.audit || []).slice(0, 8));
    content.innerHTML = `<div class="settings-layout"><section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Usuários e Permissões</h2><p>Solicitações, perfis, bloqueios e permissões do sistema.</p></div><span class="option-status info">${(usersData.users || []).length} conta(s)</span></header><div class="panel-body">${message ? notice(message, kind) : ''}<div class="settings-user-table"><table><thead><tr><th>Usuário</th><th>Perfil</th><th>Situação</th><th>Cadastro</th><th>Ação</th></tr></thead><tbody>${userRows}</tbody></table></div></div></section>${panel('Atividade administrativa', 'Ações recentes dos administradores do sistema.', `<div class="panel-body"><div class="settings-audit-list">${auditRows}</div></div>`, 'wide')}</div>`;
    content.querySelectorAll('[data-user-edit]').forEach(button => button.addEventListener('click', () => openUserEditor(button.dataset.userEdit)));
    content.querySelectorAll('[data-user-approve]').forEach(button => button.addEventListener('click', async () => { button.disabled = true; try { await api().manageUser({ id: button.dataset.userApprove, action: 'approve' }); await showUsers('Conta aprovada com sucesso.', 'success'); } catch (error) { await showUsers(error.message || 'Não foi possível aprovar a conta.', 'error'); } }));
  }

  function showAppearance(message = '', kind = '') {
    selectTab('appearance');
    content.innerHTML = `<div class="settings-layout"><section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Aparência</h2><p>Escolha a apresentação visual do ALDECKOT. A preferência é aplicada em todos os módulos.</p></div></header><div class="panel-body"><div class="settings-appearance"><div class="theme-preview"><div class="preview-bar"></div><div class="preview-lines"><i></i><i></i><i></i></div></div><label class="theme-choice" for="themeSwitch"><span><b>Tema claro</b><span>Use uma superfície clara mantendo detalhes em azul e ciano.</span></span><i class="toggle-visual" aria-hidden="true"></i></label></div>${message ? `<div style="margin-top:13px">${notice(message, kind)}</div>` : ''}</div></section>${panel('Identidade visual', 'Padrões preservados na navegação e nos módulos.', `<div class="settings-option-list"><div class="settings-option"><span class="option-icon">◌</span><span class="option-copy"><b>Superfícies translúcidas</b><span>Cartões, painéis e modais seguem o padrão visual do sistema.</span></span><span class="option-status info">Ativo</span></div><div class="settings-option"><span class="option-icon">⌁</span><span class="option-copy"><b>Movimento reduzido e elegante</b><span>Microinterações respeitam a preferência de acessibilidade do dispositivo.</span></span></div></div>`)}</div>`;
  }

  function showIntegrations() {
    selectTab('integrations');
    content.innerHTML = `<div class="settings-layout"><section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Integrações</h2><p>Serviços utilizados pelo ALDECKOT para manter os dados corporativos centralizados.</p></div></header><div class="settings-option-list"><div class="settings-option"><span class="option-icon">▣</span><span class="option-copy"><b>Supabase PostgreSQL</b><span>Base de dados, autenticação e atualizações em tempo real do sistema.</span></span><span class="option-status">Conectado</span></div><div class="settings-option"><span class="option-icon">⌁</span><span class="option-copy"><b>Sincronização em tempo real</b><span>Alterações autorizadas chegam automaticamente às telas conectadas.</span></span><span class="option-status info">Ativa</span></div></div></section>${panel('Observação', 'As credenciais sensíveis permanecem exclusivamente no ambiente seguro do servidor.', `<div class="panel-body"><div class="settings-note"><strong>Proteção ativa.</strong> Nenhuma chave administrativa é exposta nesta tela ou no navegador.</div></div>`)}</div>`;
  }

  function showNotifications() {
    selectTab('notifications');
    content.innerHTML = `<div class="settings-layout"><section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Notificações</h2><p>Visão operacional dos avisos que acompanham os módulos do sistema.</p></div></header><div class="settings-option-list"><div class="settings-option"><span class="option-icon">♧</span><span class="option-copy"><b>Eventos operacionais</b><span>Atualizações de equipamentos e atividades ficam disponíveis na Central do Equipamento.</span></span><span class="option-status info">Monitorado</span></div><div class="settings-option"><span class="option-icon">▤</span><span class="option-copy"><b>Auditoria administrativa</b><span>Aprovações, bloqueios e alterações de acesso são registradas com segurança.</span></span><span class="option-status">Ativa</span></div></div></section>${panel('Preferências pessoais', 'O sistema mantém o comportamento atual de notificações sem alterar regras de negócio.', `<div class="panel-body"><div class="settings-note">As notificações seguem as configurações existentes dos módulos. Esta área centraliza sua visualização, sem alterar fluxos operacionais.</div></div>`)}</div>`;
  }

  function showBackup() {
    selectTab('backup');
    content.innerHTML = `<div class="settings-layout"><section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Backup</h2><p>Os backups continuam organizados pelos seus respectivos módulos para preservar cada fluxo operacional.</p></div></header><div class="settings-option-list"><div class="settings-option"><span class="option-icon">↥</span><span class="option-copy"><b>Backups dos módulos</b><span>Inventário, Gestão TI, Controle TI e Flux mantêm seus próprios históricos e restaurações.</span></span><span class="option-status info">Centralizado</span></div><div class="settings-option"><span class="option-icon">◌</span><span class="option-copy"><b>Retenção de cópias</b><span>As rotinas existentes continuam sendo aplicadas sem mudanças de regra nesta tela.</span></span></div></div></section>${panel('Status', 'Acompanhamento geral do recurso.', `<div class="panel-body"><div class="settings-note"><strong>Backup monitorado.</strong> Abra o módulo desejado para criar, restaurar ou consultar o histórico detalhado.</div></div>`)}</div>`;
  }

  async function showAudit() {
    if (!state.isAdmin) return showGeneral();
    selectTab('audit');
    content.innerHTML = `<section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Auditoria</h2><p>Carregando ações administrativas recentes…</p></div></header></section>`;
    try { await refreshUsersData(); } catch (error) { content.innerHTML = `<section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Auditoria</h2></div></header><div class="panel-body">${notice(error.message || 'Não foi possível carregar a auditoria.', 'error')}</div></section>`; return; }
    content.innerHTML = `<div class="settings-layout"><section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Auditoria</h2><p>Registro de ações administrativas e eventos de segurança.</p></div><span class="option-status info">Protegida</span></header><div class="panel-body"><div class="settings-audit-list">${renderAuditRows(usersData.audit || [], true)}</div></div></section></div>`;
  }

  function renderAuditRows(rows, full = false) {
    const rendered = rows.slice(0, full ? 30 : 8).map(row => `<div class="settings-audit-item"><div><b>${escape(row.action)}</b><span> · ${escape(row.target_user_id || 'Sistema')}</span></div><span>${date(row.created_at)}</span></div>`).join('');
    return rendered || '<p class="audit-empty">Nenhuma ação administrativa registrada.</p>';
  }

  function closeModal() { modal.hidden = true; modal.innerHTML = ''; }

  function openUserEditor(id) {
    const user = (usersData.users || []).find(entry => entry.id === id); if (!user) return;
    modal.innerHTML = `<section class="user-editor" role="dialog" aria-modal="true" aria-label="Editar usuário"><header><div><h2>Editar usuário</h2><p>Código: ${escape(user.user_code)}</p></div><button class="settings-action" type="button" data-user-close>Fechar</button></header><form id="userEditorForm"><label>Nome completo<input name="fullName" required minlength="3" value="${escape(user.full_name)}"></label><label>Código de usuário<input name="userCode" inputmode="numeric" required minlength="4" maxlength="12" pattern="[0-9]+" autocomplete="username" value="${escape(user.user_code)}"></label><label>Nova senha<input name="password" type="password" minlength="8" placeholder="Deixe em branco para manter"></label><div class="editor-row"><label>Perfil<select name="role"><option value="standard" ${user.role === 'standard' ? 'selected' : ''}>Padrão</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option></select></label><label>Situação<select name="status"><option value="pending" ${user.status === 'pending' ? 'selected' : ''}>Pendente</option><option value="active" ${user.status === 'active' ? 'selected' : ''}>Ativo</option><option value="blocked" ${user.status === 'blocked' ? 'selected' : ''}>Bloqueado</option></select></label></div><div class="editor-actions"><button type="button" class="danger" data-user-delete>Excluir</button><button type="button" data-user-close>Cancelar</button><button type="submit" class="primary">Salvar</button></div></form></section>`;
    modal.hidden = false;
    modal.querySelectorAll('[data-user-close]').forEach(button => button.addEventListener('click', closeModal));
    modal.querySelector('[data-user-delete]').addEventListener('click', async () => { if (!confirm(`Excluir ${user.full_name}? Esta ação remove o acesso desta conta.`)) return; try { await api().manageUser({ id: user.id, action: 'delete' }); closeModal(); await showUsers('Usuário excluído.', 'success'); } catch (error) { alert(error.message || 'Não foi possível excluir o usuário.'); } });
    modal.querySelector('#userEditorForm').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('[type="submit"]'); button.disabled = true; try { await api().manageUser({ id: user.id, ...Object.fromEntries(new FormData(form)) }); closeModal(); await showUsers('Usuário atualizado.', 'success'); } catch (error) { button.disabled = false; alert(error.message || 'Não foi possível atualizar o usuário.'); } });
  }

  function renderSection(section, message = '', kind = '') {
    if (section === 'general') return showGeneral();
    if (section === 'security') return showSecurity(message, kind);
    if (section === 'users') return showUsers(message, kind);
    if (section === 'appearance') return showAppearance(message, kind);
    if (section === 'integrations') return showIntegrations();
    if (section === 'notifications') return showNotifications();
    if (section === 'backup') return showBackup();
    return showAudit();
  }

  tabs.forEach(button => button.addEventListener('click', () => renderSection(button.dataset.settingsTab)));
  document.getElementById('saveSettingsButton').addEventListener('click', () => {
    if (activeSection === 'security') { document.getElementById('accountForm')?.requestSubmit(); return; }
    renderSection('security', 'Revise os dados da conta e salve as alterações de segurança quando necessário.');
  });
  document.getElementById('restoreSettingsButton').addEventListener('click', () => {
    if (!confirm('Restaurar a preferência visual padrão do ALDECKOT?')) return;
    themeSwitch.checked = false;
    themeSwitch.dispatchEvent(new Event('change', { bubbles: true }));
    renderSection('appearance', 'Tema visual padrão restaurado.', 'success');
  });
  search.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    const term = search.value.trim().toLocaleLowerCase('pt-BR');
    const target = tabs.find(button => button.textContent.toLocaleLowerCase('pt-BR').includes(term));
    if (target && !target.hidden) renderSection(target.dataset.settingsTab);
  });
  document.getElementById('logoutButton').addEventListener('click', async () => { try { await api().signOut(); } finally { window.location.replace('login.html'); } });
  window.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });

  (async () => {
    await (window.AldeckotAuthReady || Promise.resolve());
    state = window.AldeckotAuth;
    if (!state) return;
    avatar.textContent = initials(state.profile.full_name);
    if (state.isAdmin) document.querySelector('[data-admin-only]').hidden = false;
    showGeneral();
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.AldeckotModuleStage?.reveal?.()));
    try { await refreshUsersData(); } catch { updateMetrics(); }
  })();
})();
