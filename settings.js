(() => {
  const content = document.getElementById('settingsContent');
  const modal = document.getElementById('settingsModal');
  const overview = document.getElementById('settingsOverview');
  const tabs = [...document.querySelectorAll('[data-settings-tab]')];
  const avatar = document.getElementById('settingsAvatar');
  const search = document.getElementById('settingsSearch');
  const themeSwitch = document.getElementById('themeSwitch');
  const profileButton = document.getElementById('settingsProfileButton');
  const sidebarProfileButton = document.getElementById('sidebarProfileButton');
  const themeToggle = document.getElementById('settingsThemeToggle');
  let state; let activeSection = 'general'; let usersData = { users: [], audit: [] };
  let auditFilters = { period: '', cutoff: '' };
  let auditState = { data: null, reports: [], archiveError: '' };
  let auditPreviewObjectUrl = '';

  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const api = () => window.AldeckotSupabase.auth;
  const date = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const roleName = value => value === 'admin' ? 'Administrador' : 'Padrão';
  const statusName = value => ({ active: 'Ativo', pending: 'Pendente', blocked: 'Bloqueado' })[value] || value;
  const notice = (text, kind = '') => `<p class="settings-status ${kind}">${escape(text)}</p>`;
  const initials = name => String(name || 'AD').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'AD';
  const panel = (title, description, body, extra = '', icon = '') => `<section class="settings-panel-card ${extra}"><header class="panel-heading">${icon ? `<span class="panel-heading-icon" aria-hidden="true">${icon}</span>` : ''}<div><h2>${title}</h2>${description ? `<p>${description}</p>` : ''}</div></header>${body}</section>`;
  const backend = () => window.AldeckotSupabase;

  function selectTab(name) {
    activeSection = name;
    tabs.forEach(button => button.classList.toggle('active', button.dataset.settingsTab === name));
    if (overview) overview.hidden = name !== 'general';
  }

  function syncThemeControl() {
    const light = Boolean(themeSwitch?.checked);
    themeToggle?.setAttribute('aria-pressed', String(light));
    const name = document.getElementById('settingsThemeName');
    const icon = document.querySelector('.settings-theme-icon');
    if (name) name.textContent = light ? 'Modo Claro' : 'Modo Escuro';
    if (icon) icon.textContent = light ? '☼' : '☾';
  }

  function updateIdentity() {
    if (!state?.profile) return;
    const label = state.profile.full_name || 'Conta conectada';
    const role = roleName(state.profile.role);
    avatar.textContent = initials(label);
    document.getElementById('sidebarProfileAvatar').textContent = initials(label);
    document.getElementById('settingsProfileName').textContent = label;
    document.getElementById('settingsProfileRole').textContent = role;
    document.getElementById('sidebarProfileName').textContent = label;
    document.getElementById('sidebarProfileRole').textContent = role;
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
    const version = window.AldeckotSystemVersion?.label || 'V2.0.12';
    const detail = (icon, label, value, description, target, status = '') => `<button class="settings-detail is-button" type="button" data-open-section="${target}"><i aria-hidden="true">${icon}</i><span>${label}</span><b>${escape(value)}</b><small>${description}</small>${status ? `<em class="detail-status">${status}</em>` : '<em aria-hidden="true">›</em>'}</button>`;
    content.innerHTML = `<div class="settings-layout">
      ${panel('Visão geral', 'Informações centrais da conta e do ambiente ALDECKOT.', `<div class="panel-body"><div class="settings-detail-grid">${detail('●', 'Conta conectada', profile.full_name, roleName(profile.role), 'security')}${detail('▣', 'Perfil de acesso', roleName(profile.role), state.isAdmin ? 'Acesso administrativo integral' : 'Permissões atribuídas à conta', 'security')}${detail('◉', 'Estado da conta', statusName(profile.status), 'Conta habilitada para o sistema', 'security', statusName(profile.status))}${detail('⌘', 'Dados compartilhados', 'Sincronização central ativa', 'Supabase e módulos conectados', 'integrations')}${detail('◇', 'Versão do sistema', version, 'Identificação atual da entrega do ALDECKOT', 'general', 'Atual')}</div></div>`, '', '▦')}
      ${panel('Segurança e acesso', 'Controles pessoais e administrativos do ambiente.', `<div class="settings-option-list">${option('♢', 'Credenciais da conta', 'Nome, código de usuário e senha do usuário conectado.', 'security', { text: 'Seguro' })}${state.isAdmin ? option('♧', 'Usuários e permissões', 'Aprovação de acessos, perfis e bloqueios.', 'users', { text: 'Administrar', kind: 'info' }) : ''}${state.isAdmin ? option('▤', 'Auditoria mensal', 'Relatórios completos e arquivo de PDFs por período.', 'audit') : ''}</div>`, '', '♢')}
      ${panel('Personalização', 'A aparência visual acompanha o tema escolhido no ALDECKOT.', `<div class="settings-option-list">${option('◉', 'Aparência do sistema', 'Tema claro ou escuro com o mesmo padrão visual.', 'appearance')}${option('♧', 'Notificações', 'Resumo dos avisos e alertas da plataforma.', 'notifications')}</div>`, '', '◉')}
      ${panel('Operação e dados', 'Conexões e recursos já utilizados pelos módulos.', `<div class="settings-option-list">${option('⌘', 'Integrações', 'Conectado com outros sistemas e serviços.', 'integrations', { text: 'Conectado', kind: 'info' })}${option('↥', 'Backup', 'Visão geral das cópias gerenciadas por módulo.', 'backup')}</div>`, '', '▣')}
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
        updateIdentity();
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

  async function showIntegrations(message = '', kind = '') {
    selectTab('integrations');
    content.innerHTML = `<section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Integrações e integridade</h2><p>Conferindo a conexão central e os vínculos de TAG e número de série…</p></div></header></section>`;
    try {
      const conflicts = (await backend().operations.identityConflicts()).filter(row => !['***', '-'].includes(String(row.identity_value || '').trim().toLowerCase()));
      const conflictRows = conflicts.length ? conflicts.map((row, index) => `<div class="settings-option"><span class="option-icon">!</span><span class="option-copy"><b>${escape(row.identity_kind)}: ${escape(row.identity_value)}</b><span>${escape(row.conflict_type)} · ${escape((row.modules || []).join(' · '))}</span></span><button class="settings-action resolve" type="button" data-resolve-conflict="${index}">✓ Marcar como resolvido</button></div>`).join('') : '<div class="settings-note"><strong>Conciliação aprovada.</strong> Não há divergências de TAG ou número de série entre os módulos sincronizados.</div>';
      content.innerHTML = `<div class="settings-layout"><section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Integrações</h2><p>Serviços utilizados pelo ALDECKOT para manter os dados corporativos centralizados.</p></div></header><div class="settings-option-list"><div class="settings-option"><span class="option-icon">▣</span><span class="option-copy"><b>Supabase PostgreSQL</b><span>Base de dados, autenticação e atualizações em tempo real do sistema.</span></span><span class="option-status">Conectado</span></div><div class="settings-option"><span class="option-icon">⌁</span><span class="option-copy"><b>Sincronização em tempo real</b><span>Alterações autorizadas chegam automaticamente às telas conectadas.</span></span><span class="option-status info">Ativa</span></div></div></section>${panel('Conciliação de equipamentos', 'A mesma TAG pode existir em módulos sincronizados; TAGs e números de série “***” ou “-” são tratados como não informados.', `<div class="panel-body">${message ? notice(message, kind) : ''}<div class="settings-option-list">${conflictRows}</div></div>`, 'wide', '⌕')}${panel('Observação', 'As credenciais sensíveis permanecem exclusivamente no ambiente seguro do servidor.', `<div class="panel-body"><div class="settings-note"><strong>Proteção ativa.</strong> Nenhuma chave administrativa é exposta nesta tela ou no navegador.</div></div>`)}</div>`;
      content.querySelectorAll('[data-resolve-conflict]').forEach(button => button.addEventListener('click', async () => {
        const conflict = conflicts[Number(button.dataset.resolveConflict)];
        if (!conflict) return;
        button.disabled = true;
        button.textContent = 'Resolvendo…';
        try {
          await backend().operations.resolveIdentityConflict(conflict);
          await showIntegrations('Conciliação marcada como resolvida. O item foi removido da lista.', 'success');
        } catch (error) {
          button.disabled = false;
          button.textContent = '✓ Marcar como resolvido';
          const feedback = content.querySelector('.settings-status');
          if (feedback) { feedback.textContent = error.message || 'Não foi possível resolver a conciliação.'; feedback.className = 'settings-status error'; }
        }
      }));
    } catch (error) {
      content.innerHTML = `<div class="settings-layout"><section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Integrações</h2><p>Serviços utilizados pelo ALDECKOT para manter os dados corporativos centralizados.</p></div></header><div class="settings-option-list"><div class="settings-option"><span class="option-icon">▣</span><span class="option-copy"><b>Supabase PostgreSQL</b><span>Base de dados, autenticação e atualizações em tempo real do sistema.</span></span><span class="option-status">Conectado</span></div></div></section>${panel('Conciliação de equipamentos', 'A validação será habilitada após a migração 031.', `<div class="panel-body">${notice(error.message || 'Ainda não foi possível consultar divergências.', 'error')}</div>`, 'wide', '⌕')}</div>`;
    }
  }

  function showNotifications() {
    selectTab('notifications');
    content.innerHTML = `<div class="settings-layout"><section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Notificações</h2><p>Visão operacional dos avisos que acompanham os módulos do sistema.</p></div></header><div class="settings-option-list"><div class="settings-option"><span class="option-icon">♧</span><span class="option-copy"><b>Alertas inteligentes por equipamento</b><span>Os módulos priorizam defeitos, manutenções sem andamento, itens em análise e transferências pendentes.</span></span><span class="option-status info">Monitorado</span></div><div class="settings-option"><span class="option-icon">▤</span><span class="option-copy"><b>Auditoria administrativa</b><span>Aprovações, bloqueios e alterações de acesso são registradas com segurança.</span></span><span class="option-status">Ativa</span></div></div></section>${panel('Como os alertas funcionam', 'A Central de Notificações de cada módulo orienta a próxima providência.', `<div class="panel-body"><div class="settings-note"><strong>Priorização por contexto.</strong> Cada alerta considera o status, a prioridade e o tempo sem atualização. Os cinco casos mais importantes exibem o próximo passo — analisar, investigar ou providenciar uma ação — e permanecem visíveis até o equipamento ser atualizado ou o aviso ser marcado como acompanhado.</div></div>`)}</div>`;
  }

  async function showBackup() {
    selectTab('backup');
    content.innerHTML = `<section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Backup</h2><p>Conferindo as cópias disponíveis e as rotinas automáticas dos módulos…</p></div></header></section>`;
    const label = { inventory: 'Inventário', management: 'Gestão TI', control: 'Controle TI', flux: 'Flux' };
    const page = { inventory: 'inventory.html', management: 'management.html', control: 'control.html', flux: 'flux.html' };
    try {
      const health = await backend().operations.backupHealth();
      const cards = health.map(entry => `<button class="settings-option is-button" type="button" data-backup-module="${entry.module}"><span class="option-icon">${entry.ok ? '↥' : '!'}</span><span class="option-copy"><b>${label[entry.module]}</b><span>${entry.latest ? `Última cópia: ${date(entry.latest.created_at)} · ${entry.latest.source === 'automatic' ? 'automática' : 'manual'}` : 'Nenhuma cópia disponível ainda.'}</span></span><span class="option-status ${entry.ok ? 'info' : ''}">${entry.automatic ? 'Automático' : entry.ok ? 'Monitorado' : 'Verificar'}</span></button>`).join('');
      content.innerHTML = `<div class="settings-layout"><section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Central de backups</h2><p>O status mostra a cópia mais recente; o histórico e a restauração ficam no módulo correspondente.</p></div><span class="option-status info">4 módulos</span></header><div class="settings-option-list">${cards}</div></section>${panel('Proteção e recuperação', 'Boas práticas aplicadas às cópias corporativas.', `<div class="panel-body"><div class="settings-note"><strong>Rotinas separadas e seguras.</strong> Cada módulo conserva até as três cópias mais recentes. Abra um módulo para gerar uma cópia, ativar a rotina automática, consultar o histórico ou restaurar dados.</div></div>`)}</div>`;
      content.querySelectorAll('[data-backup-module]').forEach(button => button.addEventListener('click', () => { const destination = page[button.dataset.backupModule]; if (window.AldeckotRoute?.navigate) window.AldeckotRoute.navigate(destination); else window.location.href = destination; }));
    } catch (error) {
      content.innerHTML = `<section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Backup</h2><p>Não foi possível conferir as cópias agora.</p></div></header><div class="panel-body">${notice(error.message || 'Abra um módulo para consultar o histórico de backup.', 'error')}</div></section>`;
    }
  }

  const auditModules = {
    inventory: { label: 'Inventário', icon: '▣' }, management: { label: 'Gestão TI', icon: '◉' },
    control: { label: 'Controle TI', icon: '▤' }, flux: { label: 'Flux', icon: '↔' },
    nfe: { label: 'Fiscal NF-e', icon: '▧' }, agenda: { label: 'Agenda', icon: '◷' }
  };
  const auditOperation = value => ({ create: 'Inclusão', update: 'Atualização', delete: 'Exclusão', log: 'Novo registro' })[value] || 'Atualização';
  const saoPauloDate = () => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = type => parts.find(entry => entry.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  const auditPeriod = value => String(value || '').slice(0, 7);
  const auditMonthLabel = value => {
    const dateValue = new Date(`${auditPeriod(value)}-01T12:00:00`);
    const label = dateValue.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return label.replace(/^./, letter => letter.toUpperCase());
  };
  const auditLastDay = value => {
    const [year, month] = auditPeriod(value).split('-').map(Number);
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  };
  const auditDefaultCutoff = value => auditPeriod(value) === auditPeriod(saoPauloDate()) ? saoPauloDate() : auditLastDay(value);
  const auditDateTime = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : '—';
  const auditDate = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR') : '—';
  const pdfText = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/•/g, '-').replace(/[^\x20-\x7E]/g, '?');
  const auditActivityText = entry => {
    const details = entry.details || {};
    const subject = details.equipment || details.tableName || 'Registro do módulo';
    const description = details.description || `${auditOperation(entry.operation)} registrada no módulo.`;
    return `${subject}: ${description}`;
  };
  const auditSummary = data => {
    const tasks = data.agendaEntries.filter(entry => entry.kind === 'task').length;
    const events = data.agendaEntries.filter(entry => entry.kind === 'event').length;
    const byModule = Object.fromEntries(Object.keys(auditModules).map(module => [module, 0]));
    data.activities.forEach(entry => { byModule[entry.module] = (byModule[entry.module] || 0) + 1; });
    return { tasks, events, completed: tasks + events, activities: data.activities.length, byModule };
  };
  const auditIsFinal = data => data.cutoff === auditLastDay(data.periodStart) && saoPauloDate() > data.cutoff;
  const auditFileName = data => `auditoria-${auditPeriod(data.periodStart)}-${data.cutoff}.pdf`;

  function createNativeAuditPdf(data) {
    const pageWidth = 595; const pageHeight = 842; const margin = 42; const bottom = 54;
    const pages = []; let current; let y; const summary = auditSummary(data);
    const escapePdf = value => pdfText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const command = value => current.push(value);
    const fill = (r, g, b) => command(`${r} ${g} ${b} rg`);
    const stroke = (r, g, b) => command(`${r} ${g} ${b} RG`);
    const rect = (x, top, width, height, mode = 'f') => command(`${x} ${pageHeight - top - height} ${width} ${height} re ${mode}`);
    const text = (value, x, top, size = 9, bold = false, color = [0.09, 0.22, 0.34]) => {
      fill(...color); command(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${pageHeight - top} Td (${escapePdf(value)}) Tj ET`);
    };
    const wrap = (value, size, width) => {
      const limit = Math.max(18, Math.floor(width / (size * 0.53))); const words = pdfText(value).split(/\s+/); const lines = []; let line = '';
      words.forEach(word => { const next = `${line} ${word}`.trim(); if (next.length > limit && line) { lines.push(line); line = word; } else line = next; });
      if (line) lines.push(line); return lines;
    };
    const footer = () => {
      stroke(0.62, 0.74, 0.84); command(`${margin} 28 m ${pageWidth - margin} 28 l S`);
      text('ALDECKOT - Relatorio mensal de auditoria', margin, pageHeight - 18, 7.5, false, [0.32, 0.44, 0.56]);
      text(`Pagina ${pages.length}`, pageWidth - 78, pageHeight - 18, 7.5, false, [0.32, 0.44, 0.56]);
    };
    const startPage = () => {
      current = []; pages.push(current); y = 47;
      fill(0.02, 0.10, 0.19); rect(0, 0, pageWidth, 35);
      text('ALDECKOT', margin, 13, 10, true, [0.28, 0.88, 1]);
      text(pages.length === 1 ? 'Relatorio mensal de auditoria' : 'Relatorio mensal de auditoria - continuacao', margin, 25, 15, true, [0.96, 0.99, 1]);
      text(`${auditMonthLabel(data.periodStart)} - apurado ate ${auditDate(data.cutoff)}`, margin, 31, 7.8, false, [0.70, 0.84, 0.94]);
    };
    const need = amount => { if (y + amount > pageHeight - bottom) { footer(); startPage(); } };
    const heading = (title, subtitle = '') => {
      need(24); fill(0.04, 0.21, 0.36); rect(margin, y, pageWidth - margin * 2, 12);
      text(title, margin + 5, y + 8, 10, true, [0.94, 0.99, 1]); y += 17;
      if (subtitle) { text(subtitle, margin, y, 7.8, false, [0.30, 0.46, 0.60]); y += 7; }
    };
    const row = (value, tone = [0.16, 0.48, 0.70]) => {
      const lines = wrap(value, 8.2, pageWidth - margin * 2 - 15); const height = Math.max(14, lines.length * 10 + 5); need(height + 3);
      fill(0.96, 0.985, 1); rect(margin, y, pageWidth - margin * 2, height);
      fill(...tone); rect(margin, y, 3, height);
      lines.forEach((line, index) => text(line, margin + 8, y + 8 + index * 10, 8.2)); y += height + 4;
    };
    const card = (x, title, value) => {
      fill(0.92, 0.97, 1); rect(x, y, 245, 31); stroke(0.56, 0.75, 0.88); command(`${x} ${pageHeight - y - 31} 245 31 re S`);
      text(title, x + 8, y + 10, 7.4, false, [0.30, 0.46, 0.60]); text(String(value), x + 8, y + 23, 14, true, [0.04, 0.24, 0.39]);
    };

    startPage();
    heading('Resumo executivo', 'Consolidacao das atividades concluidas e das atualizacoes registradas pelos modulos.');
    card(margin, 'Tarefas concluidas', summary.tasks); card(margin + 266, 'Eventos realizados', summary.events); y += 38;
    card(margin, 'Atualizacoes dos modulos', summary.activities); card(margin + 266, 'Total de registros', summary.completed + summary.activities); y += 39;
    heading('Compromissos realizados', 'Tarefas e eventos entram somente apos serem marcados como concluidos.');
    if (!data.agendaEntries.length) row('Nenhuma tarefa ou evento foi concluido dentro do periodo selecionado.', [0.42, 0.54, 0.63]);
    data.agendaEntries.forEach(entry => row(`${entry.kind === 'task' ? 'Tarefa' : 'Evento'} - ${auditDateTime(entry.completedAt)} - ${entry.title}`, entry.kind === 'task' ? [0.10, 0.58, 0.38] : [0.36, 0.27, 0.72]));
    heading('Atualizacoes dos modulos', 'Registros que alimentam o painel Ultimos itens atualizados da Home.');
    if (!data.activities.length) row('Nenhuma atualizacao de modulo foi registrada dentro do periodo selecionado.', [0.42, 0.54, 0.63]);
    data.activities.forEach(entry => {
      const info = auditModules[entry.module] || { label: 'Modulo' };
      row(`${info.label} - ${auditOperation(entry.operation)} - ${auditDateTime(entry.occurredAt)} - ${auditActivityText(entry)}`);
    });
    heading('Distribuicao por modulo');
    Object.entries(summary.byModule).filter(([, total]) => total > 0).forEach(([module, total]) => row(`${auditModules[module]?.label || module}: ${total} atualizacao(oes).`));
    if (!Object.values(summary.byModule).some(Boolean)) row('Nao houve movimentacoes de modulos no periodo.', [0.42, 0.54, 0.63]);
    footer();

    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      `<< /Type /Pages /Kids [${pages.map((_, index) => `${5 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'
    ];
    pages.forEach((commands, index) => {
      const pageId = 5 + index * 2; const contentId = pageId + 1; const stream = commands.join('\n');
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
      objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    });
    let output = '%PDF-1.4\n'; const offsets = [0];
    objects.forEach((object, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = output.length; output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach(offset => { output += `${String(offset).padStart(10, '0')} 00000 n \n`; });
    output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([new TextEncoder().encode(output)], { type: 'application/pdf' });
  }

  function createAuditPdf(data) {
    const JsPdf = window.jspdf?.jsPDF;
    if (!JsPdf) return createNativeAuditPdf(data);
    const doc = new JsPdf({ unit: 'mm', format: 'a4' });
    const width = doc.internal.pageSize.getWidth(); const height = doc.internal.pageSize.getHeight();
    const margin = 15; const usable = width - margin * 2; let y = 16; let page = 1;
    const summary = auditSummary(data);
    const footer = () => {
      doc.setDrawColor(150, 188, 218); doc.line(margin, height - 12, width - margin, height - 12);
      doc.setTextColor(78, 112, 143); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text('ALDECKOT - Relatório mensal de auditoria', margin, height - 7);
      doc.text(`Página ${page}`, width - margin, height - 7, { align: 'right' });
    };
    const newPage = () => { footer(); doc.addPage(); page += 1; y = 16; };
    const room = amount => { if (y + amount > height - 19) newPage(); };
    const heading = (title, subtitle = '') => {
      room(18); doc.setFillColor(7, 39, 70); doc.roundedRect(margin, y, usable, 11, 2, 2, 'F');
      doc.setTextColor(232, 248, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(pdfText(title), margin + 5, y + 7);
      y += 15;
      if (subtitle) { doc.setTextColor(62, 96, 128); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(pdfText(subtitle), margin, y); y += 5; }
    };
    const line = (text, tone = [32, 70, 103]) => {
      const lines = doc.splitTextToSize(pdfText(text), usable - 8); room(lines.length * 4.4 + 4);
      doc.setFillColor(244, 249, 253); doc.roundedRect(margin, y, usable, lines.length * 4.4 + 3, 1.5, 1.5, 'F');
      doc.setFillColor(...tone); doc.circle(margin + 3, y + 4, 1, 'F');
      doc.setTextColor(23, 57, 87); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.7); doc.text(lines, margin + 7, y + 5);
      y += lines.length * 4.4 + 5;
    };

    doc.setFillColor(4, 25, 47); doc.rect(0, 0, width, 36, 'F');
    doc.setTextColor(70, 224, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('ALDECKOT', margin, 13);
    doc.setTextColor(244, 250, 255); doc.setFontSize(19); doc.text('Relatório mensal de auditoria', margin, 23);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(174, 208, 234);
    doc.text(`${auditMonthLabel(data.periodStart)} · apurado até ${auditDate(data.cutoff)}`, margin, 30);
    y = 45;
    heading('Resumo executivo', 'Consolidação das atividades concluídas e das atualizações que alimentam os módulos.');
    const cards = [
      ['Tarefas concluídas', summary.tasks], ['Eventos realizados', summary.events],
      ['Atualizações dos módulos', summary.activities], ['Total de registros', summary.completed + summary.activities]
    ];
    const cardWidth = (usable - 6) / 2;
    cards.forEach(([label, value], index) => {
      const col = index % 2; if (col === 0 && index > 0) y += 18;
      const x = margin + col * (cardWidth + 6);
      doc.setFillColor(235, 246, 253); doc.setDrawColor(146, 194, 226); doc.roundedRect(x, y, cardWidth, 15, 2, 2, 'FD');
      doc.setTextColor(74, 113, 144); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.text(pdfText(label), x + 4, y + 5);
      doc.setTextColor(10, 58, 94); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(String(value), x + 4, y + 11);
    });
    y += 22;
    heading('Compromissos realizados', 'Tarefas e eventos entram no relatório somente após serem marcados como concluídos.');
    if (!data.agendaEntries.length) line('Nenhuma tarefa ou evento foi concluído dentro do período selecionado.', [110, 137, 161]);
    data.agendaEntries.forEach(entry => line(`${entry.kind === 'task' ? 'Tarefa' : 'Evento'} · ${auditDateTime(entry.completedAt)} · ${entry.title}`, entry.kind === 'task' ? [28, 154, 103] : [90, 78, 190]));
    heading('Atualizações dos módulos', 'Registros exibidos no painel Últimos itens atualizados, organizados por data e módulo.');
    if (!data.activities.length) line('Nenhuma atualização de módulo foi registrada dentro do período selecionado.', [110, 137, 161]);
    data.activities.forEach(entry => {
      const info = auditModules[entry.module] || { label: 'Módulo' };
      line(`${info.label} · ${auditOperation(entry.operation)} · ${auditDateTime(entry.occurredAt)} · ${auditActivityText(entry)}`);
    });
    heading('Distribuição por módulo');
    Object.entries(summary.byModule).filter(([, total]) => total > 0).forEach(([module, total]) => line(`${auditModules[module]?.label || module}: ${total} atualização(ões).`, [28, 126, 183]));
    if (!Object.values(summary.byModule).some(Boolean)) line('Não houve movimentações de módulos no período.', [110, 137, 161]);
    footer();
    return doc.output('blob');
  }

  function downloadAuditBlob(blob, data) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = auditFileName(data); link.hidden = true;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  }

  const auditFileSize = bytes => {
    const value = Number(bytes || 0);
    if (!value) return 'PDF';
    return `${(value / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB`;
  };

  function renderAuditArchive(reports) {
    if (!reports.length) return '<p class="audit-files-empty">Ainda não há relatórios arquivados. Gere o PDF do período para criar o primeiro arquivo.</p>';
    return `<div class="audit-files-table" role="table" aria-label="Relatórios de auditoria arquivados"><div class="audit-files-table-head" role="row"><span>Mês / Ano</span><span>Data de geração</span><span>Tamanho</span><span>Ações</span></div>${reports.map(report => `<article class="audit-file-row" role="row"><span class="audit-file-month"><i aria-hidden="true">PDF</i><b>${escape(auditMonthLabel(report.period_start))}</b></span><time>${escape(date(report.generated_at))}</time><span>${escape(auditFileSize(report.pdf_size))}</span><span class="audit-file-actions"><button type="button" title="Baixar PDF" aria-label="Baixar PDF de ${escape(auditMonthLabel(report.period_start))}" data-audit-download="${escape(report.id)}">⇩</button><button type="button" title="Abrir relatório" aria-label="Abrir PDF de ${escape(auditMonthLabel(report.period_start))}" data-audit-open="${escape(report.id)}">▱</button></span></article>`).join('')}</div>`;
  }

  async function persistAuditPdf(data, blob, finalized) {
    const summary = auditSummary(data);
    return backend().auditReports.save({
      periodStart: data.periodStart, cutoff: data.cutoff, finalized, pdf: blob,
      summary: { ...summary, period: auditPeriod(data.periodStart), cutoff: data.cutoff }
    });
  }

  function openAuditSettings() {
    modal.innerHTML = `<section class="user-editor audit-settings-dialog" role="dialog" aria-modal="true" aria-label="Configurações da auditoria"><header><div><h2>Configurações da Auditoria</h2><p>Relatórios mensais e fechamento automático</p></div><button class="settings-action" type="button" data-audit-settings-close>Fechar</button></header><div class="audit-settings-copy"><p><b>Fechamento mensal ativo</b> — ao acessar as Configurações no mês seguinte, o sistema gera e arquiva o PDF final do mês anterior.</p><p><b>Relatórios parciais</b> — você pode gerar e armazenar um PDF do mês em andamento a qualquer momento.</p><p><b>Conteúdo protegido</b> — somente administradores podem consultar ou baixar os arquivos da auditoria.</p></div><div class="editor-actions"><button class="primary" type="button" data-audit-settings-close>Entendi</button></div></section>`;
    modal.hidden = false;
    modal.querySelectorAll('[data-audit-settings-close]').forEach(button => button.addEventListener('click', closeModal));
  }

  function openAuditPreview({ blob = null, url = '', data = null, report = null, title = 'Visualização do relatório' }) {
    if (auditPreviewObjectUrl) { URL.revokeObjectURL(auditPreviewObjectUrl); auditPreviewObjectUrl = ''; }
    const source = blob ? URL.createObjectURL(blob) : url;
    if (blob) auditPreviewObjectUrl = source;
    if (!source) throw new Error('Não foi possível preparar a visualização do relatório.');
    modal.innerHTML = `<section class="audit-preview-dialog" role="dialog" aria-modal="true" aria-label="${escape(title)}"><header><div><span aria-hidden="true">PDF</span><div><h2>${escape(title)}</h2><p>${escape(data ? `${auditMonthLabel(data.periodStart)} · apurado até ${auditDate(data.cutoff)}` : auditMonthLabel(report?.period_start))}</p></div></div><div><button class="settings-action" type="button" data-audit-preview-download>⇩ Baixar PDF</button><button class="settings-action" type="button" data-audit-preview-close>Fechar</button></div></header><div class="audit-preview-frame"><iframe src="${escape(source)}#view=FitH" title="${escape(title)}"></iframe></div></section>`;
    modal.hidden = false;
    modal.querySelector('[data-audit-preview-close]').addEventListener('click', closeModal);
    modal.querySelector('[data-audit-preview-download]').addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true;
      try {
        if (blob && data) downloadAuditBlob(blob, data);
        else if (report) await openArchivedAudit(report, true);
      } catch (error) { window.AldeckotMessage.show(error.message || 'Não foi possível baixar o PDF.'); }
      finally { button.disabled = false; }
    });
  }

  async function makeAuditPdf({ download = false, save = false }) {
    if (!auditState.data) return;
    const blob = createAuditPdf(auditState.data);
    if (download) downloadAuditBlob(blob, auditState.data);
    if (!save) return { saved: false, finalized: auditIsFinal(auditState.data) };
    const finalized = auditIsFinal(auditState.data);
    await persistAuditPdf(auditState.data, blob, finalized);
    return { saved: true, finalized };
  }

  async function saveAuditPdfToComputer(blob, data) {
    if (typeof window.showSaveFilePicker !== 'function') {
      downloadAuditBlob(blob, data);
      return false;
    }
    const handle = await window.showSaveFilePicker({
      suggestedName: auditFileName(data),
      types: [{ description: 'Relatório em PDF', accept: { 'application/pdf': ['.pdf'] } }]
    });
    const writer = await handle.createWritable();
    await writer.write(blob);
    await writer.close();
    return true;
  }

  function openAuditSaveDialog() {
    if (!auditState.data) return;
    modal.innerHTML = `<section class="user-editor audit-save-dialog" role="dialog" aria-modal="true" aria-label="Escolher onde salvar o relatório"><header><div><h2>Onde deseja salvar o relatório?</h2><p>Escolha o destino do PDF de ${escape(auditMonthLabel(auditState.data.periodStart))}.</p></div><button class="settings-action" type="button" data-audit-save-close>Fechar</button></header><div class="audit-save-options"><button type="button" data-audit-save-system><span>▰</span><span><b>Pasta de relatórios do ALDECKOT</b><small>Armazena o PDF no histórico mensal do sistema.</small></span><i>›</i></button><button type="button" data-audit-save-computer><span>▣</span><span><b>Escolher local no computador</b><small>Abre a janela para selecionar a pasta e o nome do arquivo.</small></span><i>›</i></button></div><p class="audit-save-hint">O relatório fica disponível para consulta no sistema somente quando for salvo na pasta do ALDECKOT.</p></section>`;
    modal.hidden = false;
    modal.querySelector('[data-audit-save-close]').addEventListener('click', closeModal);
    const save = async (button, action) => {
      button.disabled = true;
      try { await action(); }
      catch (error) {
        if (error?.name === 'AbortError') return;
        window.AldeckotMessage.show(error.message || 'Não foi possível salvar o relatório.');
      } finally { button.disabled = false; }
    };
    modal.querySelector('[data-audit-save-system]').addEventListener('click', event => save(event.currentTarget, async () => {
      const blob = createAuditPdf(auditState.data); const finalized = auditIsFinal(auditState.data);
      await persistAuditPdf(auditState.data, blob, finalized); closeModal();
      await showAudit(`O relatório ${finalized ? 'finalizado' : 'parcial'} foi salvo na pasta do ALDECKOT.`, 'success');
    }));
    modal.querySelector('[data-audit-save-computer]').addEventListener('click', event => save(event.currentTarget, async () => {
      const blob = createAuditPdf(auditState.data); const usedPicker = await saveAuditPdfToComputer(blob, auditState.data); closeModal();
      await showAudit(usedPicker ? 'O relatório foi salvo no local escolhido no computador.' : 'O relatório foi preparado para download. Escolha o local nas opções do navegador.', 'success');
    }));
  }

  async function openArchivedAudit(report, download = false) {
    const url = await backend().auditReports.download(report, download);
    if (!url) throw new Error('Não foi possível preparar o link do relatório.');
    if (!download) return url;
    const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener'; link.download = report.pdf_name || 'relatorio-auditoria.pdf'; link.click();
    return url;
  }

  function bindAuditActions() {
    const periodInput = content.querySelector('[data-audit-period]');
    const cutoffInput = content.querySelector('[data-audit-cutoff]');
    periodInput?.addEventListener('change', () => { auditFilters.period = periodInput.value; auditFilters.cutoff = auditDefaultCutoff(periodInput.value); showAudit(); });
    cutoffInput?.addEventListener('change', () => { auditFilters.cutoff = cutoffInput.value; showAudit(); });
    const runAction = async (event, options, success) => {
      const button = event.currentTarget; if (!auditState.data) return; button.disabled = true;
      try {
        const result = await makeAuditPdf(options);
        await showAudit(`${success}${result.saved ? ` O relatório ${result.finalized ? 'finalizado' : 'parcial'} também foi salvo na pasta.` : ''}`, 'success');
      } catch (error) {
        await showAudit(`Não foi possível concluir a operação: ${error.message || 'erro inesperado'}`, 'error');
      }
    };
    content.querySelector('[data-audit-generate]')?.addEventListener('click', event => runAction(event, { download: true, save: true }, 'O PDF foi gerado e baixado.'));
    content.querySelector('[data-audit-save]')?.addEventListener('click', openAuditSaveDialog);
    content.querySelector('[data-audit-preview]')?.addEventListener('click', event => {
      const button = event.currentTarget; if (!auditState.data) return; button.disabled = true;
      try { openAuditPreview({ blob: createAuditPdf(auditState.data), data: auditState.data, title: 'Visualização do relatório' }); }
      catch (error) { window.AldeckotMessage.show(error.message || 'Não foi possível abrir a visualização do relatório.'); }
      finally { button.disabled = false; }
    });
    content.querySelector('[data-audit-folder]')?.addEventListener('click', () => content.querySelector('[data-audit-archive]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    content.querySelectorAll('[data-audit-tab]').forEach(button => button.addEventListener('click', () => {
      content.querySelectorAll('[data-audit-tab]').forEach(item => item.classList.toggle('active', item === button));
      if (button.dataset.auditTab === 'files') content.querySelector('[data-audit-archive]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (button.dataset.auditTab === 'settings') openAuditSettings();
      if (button.dataset.auditTab === 'generate') content.querySelector('[data-audit-form]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    content.querySelectorAll('[data-audit-download], [data-audit-open]').forEach(button => button.addEventListener('click', async () => {
      const id = button.dataset.auditDownload || button.dataset.auditOpen;
      const report = auditState.reports.find(item => item.id === id); if (!report) return;
      button.disabled = true;
      try {
        if (button.dataset.auditDownload) await openArchivedAudit(report, true);
        else openAuditPreview({ url: await openArchivedAudit(report), report, title: 'Visualização do relatório arquivado' });
      } catch (error) { window.AldeckotMessage.show(error.message || 'Não foi possível abrir o PDF arquivado.'); }
      finally { button.disabled = false; }
    }));
  }

  async function showAudit(message = '', kind = '') {
    if (!state.isAdmin) return showGeneral();
    selectTab('audit');
    content.innerHTML = `<section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Auditoria mensal</h2><p>Preparando o relatório consolidado do período…</p></div></header></section>`;
    const period = auditFilters.period || auditPeriod(saoPauloDate());
    const cutoff = auditFilters.cutoff || auditDefaultCutoff(period);
    auditFilters = { period, cutoff };
    try {
      const data = await backend().auditReports.activity({ period, cutoff });
      let reports = []; let archiveError = '';
      try { reports = await backend().auditReports.list(); }
      catch (error) { archiveError = error.message || 'A pasta de relatórios ainda não está disponível.'; }
      auditState = { data, reports, archiveError };
      const summary = auditSummary(data); const maxCutoff = auditPeriod(period) === auditPeriod(saoPauloDate()) ? saoPauloDate() : auditLastDay(period);
      const include = (icon, tone, title, description, value) => `<article class="audit-include-row ${tone}"><span class="audit-include-icon" aria-hidden="true">${icon}</span><span><b>${title}</b><small>${description}</small></span><strong title="Incluído no relatório">✓</strong><em>${value}</em></article>`;
      content.innerHTML = `<div class="audit-reference-layout">
        <section class="audit-reference-hero"><div class="audit-hero-intro"><span class="audit-hero-icon" aria-hidden="true">▤</span><div><h2>Auditoria</h2><p>Relatório mensal de movimentações do sistema</p><small>A auditoria reúne um relatório completo com as movimentações do sistema, incluindo tarefas, eventos e alterações realizadas nos módulos.</small></div></div><div class="audit-hero-features"><article class="calendar"><i>▦</i><b>Tarefas e eventos<br>realizados no mês</b><small>(apenas os marcados)</small></article><article class="changes"><i>↻</i><b>Últimas alterações</b><small>em todos os módulos do sistema</small></article><article class="pdf"><i>PDF</i><b>Relatório em PDF</b><small>sempre disponível<br>(gerar a qualquer momento)</small></article><article class="folder"><i>▰</i><b>Armazenamento</b><small>na pasta de relatórios<br>(histórico por mês)</small></article></div></section>
        <div class="audit-reference-left"><nav class="audit-tabs" aria-label="Ações da auditoria"><button class="active" type="button" data-audit-tab="generate"><span>▤</span>Gerar Relatório</button><button type="button" data-audit-tab="files"><span>▱</span>Arquivos Gerados</button><button type="button" data-audit-tab="settings"><span>⚙</span>Configurações</button></nav>
          <section class="audit-form-card" data-audit-form><header><span>▤</span><div><h2>Gerar Relatório de Auditoria</h2><p>Selecione o período e gere o relatório em PDF. O relatório pode ser gerado a qualquer momento, mesmo que o mês ainda não tenha sido finalizado.</p></div></header><div class="audit-form-fields"><label><span>▦</span><b>Mês</b><input data-audit-period type="month" value="${escape(period)}" max="${escape(auditPeriod(saoPauloDate()))}"></label><label><span>▤</span><b>Tipo de relatório</b><select aria-label="Tipo de relatório"><option>Completo (Tarefas + Eventos + Alterações)</option></select></label></div><label class="audit-cutoff-field"><span>⌕</span><b>Apurar até</b><input data-audit-cutoff type="date" value="${escape(cutoff)}" min="${escape(`${period}-01`)}" max="${escape(maxCutoff)}"></label><section class="audit-includes"><div class="audit-includes-title"><h3>O que será incluído no relatório?</h3><button class="audit-preview-button" type="button" data-audit-preview><span>◉</span>Visualizar relatório</button></div>${include('▦', 'calendar', 'Tarefas e eventos realizados no mês', 'Apenas as que foram marcadas como concluídas.', summary.completed)}${include('↻', 'changes', 'Últimos itens atualizados', 'Todas as alterações realizadas em todos os módulos do sistema.', summary.activities)}${include('▤', 'summary', 'Resumo geral', `Estatísticas e destaques da movimentação de ${escape(auditMonthLabel(period))}.`, summary.completed + summary.activities)}</section><div class="audit-form-actions"><button class="audit-download-action" type="button" data-audit-generate><span>PDF</span><b>Gerar e Baixar PDF</b><small>Relatório do período selecionado</small><i>›</i></button><button class="audit-save-action" type="button" data-audit-save><span>▱</span><b>Salvar no Arquivo</b><small>Armazenar na pasta de relatórios</small><i>›</i></button></div>${message ? notice(message, kind) : ''}${archiveError ? notice(`Arquivo de PDFs indisponível: ${archiveError}. Execute a migração 030 para habilitá-lo.`, 'error') : ''}</section></div>
        <aside class="audit-reference-right"><section class="audit-how-card"><div class="audit-how-visual"><span>PDF</span><i>▰</i></div><div><h2>Como funciona?</h2><ol><li>O sistema coleta todas as movimentações do mês (tarefas, eventos e alterações).</li><li>Gera um relatório completo e organizado em PDF.</li><li>O PDF pode ser baixado a qualquer momento.</li><li>Ao final do mês, o relatório é salvo automaticamente na pasta de arquivos.</li></ol></div></section><section class="audit-archive-card audit-archive" data-audit-archive><header><span>▰</span><div><h2>Arquivos gerados</h2><p>Histórico de relatórios dos últimos meses.</p></div><button type="button" data-audit-folder>▱ Abrir pasta</button></header>${renderAuditArchive(reports)}</section><p class="audit-period-note">Período atual: <b>${escape(auditMonthLabel(period))}</b> · até ${escape(auditDate(cutoff))} · ${summary.completed + summary.activities} registro(s) incluído(s).</p></aside>
      </div>`;
      bindAuditActions();
    } catch (error) {
      content.innerHTML = `<section class="settings-panel-card wide"><header class="panel-heading"><div><h2>Auditoria mensal</h2><p>Não foi possível consolidar o relatório.</p></div></header><div class="panel-body">${notice(error.message || 'Verifique se as migrações da agenda e da auditoria foram executadas.', 'error')}</div></section>`;
    }
  }

  function renderAuditRows(rows, full = false) {
    const rendered = rows.slice(0, full ? 30 : 8).map(row => `<div class="settings-audit-item"><div><b>${escape(row.action)}</b><span> · ${escape(row.target_user_id || 'Sistema')}</span></div><span>${date(row.created_at)}</span></div>`).join('');
    return rendered || '<p class="audit-empty">Nenhuma ação administrativa registrada.</p>';
  }

  function closeModal() { if (auditPreviewObjectUrl) { URL.revokeObjectURL(auditPreviewObjectUrl); auditPreviewObjectUrl = ''; } modal.hidden = true; modal.innerHTML = ''; }

  function openUserEditor(id) {
    const user = (usersData.users || []).find(entry => entry.id === id); if (!user) return;
    const modules = [
      ['inventory', 'Inventário'], ['management', 'Gestão TI'], ['control', 'Controle TI'], ['flux', 'Flux'], ['nfe', 'Fiscal NF-e']
    ];
    const actions = [['create', 'Criar'], ['update', 'Editar'], ['delete', 'Excluir'], ['backup', 'Backup']];
    const supportsModulePermissions = Object.prototype.hasOwnProperty.call(user, 'module_permissions');
    const permissions = user.module_permissions && typeof user.module_permissions === 'object' ? user.module_permissions : {};
    const permissionRows = modules.map(([module, label]) => `<div class="permission-row"><b>${label}</b><span>${actions.map(([action, actionLabel]) => `<label><input type="checkbox" data-module-permission="${module}" data-module-action="${action}" ${permissions?.[module]?.[action] ? 'checked' : ''}><i>${actionLabel}</i></label>`).join('')}</span></div>`).join('');
    modal.innerHTML = `<section class="user-editor" role="dialog" aria-modal="true" aria-label="Editar usuário"><header><div><h2>Editar usuário</h2><p>Código: ${escape(user.user_code)}</p></div><button class="settings-action" type="button" data-user-close>Fechar</button></header><form id="userEditorForm"><label>Nome completo<input name="fullName" required minlength="3" value="${escape(user.full_name)}"></label><label>Código de usuário<input name="userCode" inputmode="numeric" required minlength="4" maxlength="12" pattern="[0-9]+" autocomplete="username" value="${escape(user.user_code)}"></label><label>Nova senha<input name="password" type="password" minlength="8" placeholder="Deixe em branco para manter"></label><div class="editor-row"><label>Perfil<select name="role"><option value="standard" ${user.role === 'standard' ? 'selected' : ''}>Padrão</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option></select></label><label>Situação<select name="status"><option value="pending" ${user.status === 'pending' ? 'selected' : ''}>Pendente</option><option value="active" ${user.status === 'active' ? 'selected' : ''}>Ativo</option><option value="blocked" ${user.status === 'blocked' ? 'selected' : ''}>Bloqueado</option></select></label></div>${supportsModulePermissions ? `<fieldset class="module-permissions"><legend>Permissões por módulo</legend><p>Defina quais operações este usuário padrão pode realizar. Administradores mantêm acesso integral.</p>${permissionRows}</fieldset>` : '<div class="settings-note"><strong>Permissões por módulo indisponíveis.</strong> Execute a migração 031 para habilitar esta configuração.</div>'}<div class="editor-actions"><button type="button" class="danger" data-user-delete>Excluir</button><button type="button" data-user-close>Cancelar</button><button type="submit" class="primary">Salvar</button></div></form></section>`;
    modal.hidden = false;
    modal.querySelectorAll('[data-user-close]').forEach(button => button.addEventListener('click', closeModal));
    modal.querySelector('[data-user-delete]').addEventListener('click', async () => { if (!await window.AldeckotMessage.confirm(`Excluir ${user.full_name}? Esta ação remove o acesso desta conta.`, { title: 'Excluir usuário', confirmText: 'Excluir' })) return; try { await api().manageUser({ id: user.id, action: 'delete' }); closeModal(); await showUsers('Usuário excluído.', 'success'); } catch (error) { window.AldeckotMessage.show(error.message || 'Não foi possível excluir o usuário.'); } });
    modal.querySelector('#userEditorForm').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('[type="submit"]'); const modulePermissions = {}; form.querySelectorAll('[data-module-permission]:checked').forEach(input => { const module = input.dataset.modulePermission; const action = input.dataset.moduleAction; modulePermissions[module] ||= {}; modulePermissions[module][action] = true; }); button.disabled = true; try { await api().manageUser({ id: user.id, ...Object.fromEntries(new FormData(form)), ...(supportsModulePermissions ? { modulePermissions } : {}) }); closeModal(); await showUsers('Usuário atualizado.', 'success'); } catch (error) { button.disabled = false; window.AldeckotMessage.show(error.message || 'Não foi possível atualizar o usuário.'); } });
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
  document.querySelectorAll('[data-settings-open]').forEach(button => button.addEventListener('click', () => renderSection(button.dataset.settingsOpen)));
  profileButton?.addEventListener('click', () => renderSection('security'));
  sidebarProfileButton?.addEventListener('click', () => renderSection('security'));
  themeToggle?.addEventListener('click', () => {
    themeSwitch.checked = !themeSwitch.checked;
    themeSwitch.dispatchEvent(new Event('change', { bubbles: true }));
    syncThemeControl();
  });
  themeSwitch?.addEventListener('change', syncThemeControl);
  search.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    const term = search.value.trim().toLocaleLowerCase('pt-BR');
    const target = tabs.find(button => button.textContent.toLocaleLowerCase('pt-BR').includes(term));
    if (target && !target.hidden) renderSection(target.dataset.settingsTab);
  });
  document.getElementById('logoutButton').addEventListener('click', async () => { try { await api().signOut(); } finally { window.location.replace('login.html'); } });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeModal();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      search.focus();
      search.select();
    }
  });

  (async () => {
    await (window.AldeckotAuthReady || Promise.resolve());
    state = window.AldeckotAuth;
    if (!state) return;
    updateIdentity();
    syncThemeControl();
    if (state.isAdmin) document.querySelector('[data-admin-only]').hidden = false;
    const requestedSection = window.location.hash.replace('#', '');
    const allowedSection = ['general', 'security', 'appearance', 'integrations', 'notifications', 'backup', 'audit', 'users'].includes(requestedSection) ? requestedSection : 'general';
    showSectionForCurrentUser(allowedSection);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.AldeckotModuleStage?.reveal?.()));
    try { await refreshUsersData(); } catch { updateMetrics(); }
  })();

  function showSectionForCurrentUser(section) {
    if (!state?.isAdmin && ['audit', 'users'].includes(section)) return showGeneral();
    return renderSection(section);
  }
})();
