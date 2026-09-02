(() => {
  const content = document.getElementById('settingsContent');
  const identity = document.getElementById('settingsIdentity');
  const modal = document.getElementById('settingsModal');
  const tabs = [...document.querySelectorAll('[data-settings-tab]')];
  let state; let usersData = { users: [], audit: [] };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const api = () => window.AldeckotSupabase.auth;
  const date = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const roleName = value => value === 'admin' ? 'Administrador' : 'Padrão';
  const statusName = value => ({ active: 'Ativo', pending: 'Pendente', blocked: 'Bloqueado' })[value] || value;
  const notice = (text, kind = '') => `<p class="settings-status ${kind}">${escape(text)}</p>`;
  function tab(name) { tabs.forEach(button => button.classList.toggle('active', button.dataset.settingsTab === name)); }
  function showGeneral() {
    tab('general'); const profile = state.profile;
    content.innerHTML = `<section class="settings-panel"><h2>Geral</h2><p>Informações da sua conta e as permissões ativas no ALDECKOT.</p><div class="settings-grid"><div class="settings-detail"><span>Nome completo</span><b>${escape(profile.full_name)}</b></div><div class="settings-detail"><span>E-mail cadastrado</span><b>${escape(profile.email)}</b></div><div class="settings-detail"><span>Perfil</span><b>${roleName(profile.role)}</b></div><div class="settings-detail"><span>Situação da conta</span><b>${statusName(profile.status)}</b></div><div class="settings-detail"><span>Permissões</span><b>${state.isAdmin ? 'Acesso administrativo integral ao sistema.' : 'Consulta de dados e criação de tarefas e eventos.'}</b></div><div class="settings-detail"><span>Conta criada em</span><b>${date(profile.created_at)}</b></div></div></section>`;
  }
  function showSecurity(message = '', kind = '') {
    tab('security'); const profile = state.profile;
    content.innerHTML = `<section class="settings-panel"><h2>Segurança</h2><p>Atualize sua identificação, e-mail ou senha. A senha nunca é exibida nem salva no histórico.</p>${message ? notice(message, kind) : ''}<form id="accountForm" class="settings-form"><label><span>Nome de usuário</span><input name="fullName" required minlength="3" value="${escape(profile.full_name)}"></label><label><span>E-mail</span><input name="email" type="email" required value="${escape(profile.email)}"></label><label><span>Nova senha</span><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Deixe em branco para manter a atual"></label><button class="settings-save" type="submit">Salvar alterações</button></form></section>`;
    document.getElementById('accountForm').addEventListener('submit', async event => {
      event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); form.querySelector('button').disabled = true;
      try { const result = await api().updateOwnAccount(values); state.profile = { ...state.profile, ...result.profile }; identity.textContent = `${state.profile.full_name} · ${roleName(state.profile.role)}`; showSecurity('Dados de segurança atualizados.', 'success'); }
      catch (error) { showSecurity(error.message || 'Não foi possível atualizar sua conta.', 'error'); }
    });
  }
  async function showUsers(message = '', kind = '') {
    if (!state.isAdmin) return showGeneral();
    tab('users'); content.innerHTML = `<section class="settings-panel"><h2>Usuários</h2><p>Carregando contas e histórico administrativo…</p></section>`;
    try { usersData = await api().listUsers(); } catch (error) { content.innerHTML = `<section class="settings-panel"><h2>Usuários</h2>${notice(error.message || 'Não foi possível carregar os usuários.', 'error')}</section>`; return; }
    const userRows = (usersData.users || []).map(user => `<tr><td><b>${escape(user.full_name)}</b><br><small>${escape(user.email)}</small></td><td><span class="role-tag ${escape(user.role)}">${roleName(user.role)}</span></td><td><span class="account-tag ${escape(user.status)}">${statusName(user.status)}</span></td><td>${date(user.created_at)}</td><td>${user.status === 'pending' ? `<button class="settings-action approve" data-user-approve="${user.id}">Aprovar</button> ` : ''}<button class="settings-action" data-user-edit="${user.id}">Editar</button></td></tr>`).join('') || '<tr><td colspan="5">Nenhuma conta cadastrada.</td></tr>';
    const auditRows = (usersData.audit || []).slice(0, 10).map(row => `<div class="settings-audit-item"><div><b>${escape(row.action)}</b><span> · ${escape(row.target_user_id || 'Sistema')}</span></div><span>${date(row.created_at)}</span></div>`).join('') || '<p>Nenhuma ação administrativa registrada.</p>';
    content.innerHTML = `<section class="settings-panel"><div class="settings-users-head"><div><h2>Usuários</h2><p>Solicitações, perfis, bloqueios e permissões do sistema.</p></div></div>${message ? notice(message, kind) : ''}<div class="settings-user-table"><table><thead><tr><th>Usuário</th><th>Perfil</th><th>Situação</th><th>Cadastro</th><th>Ação</th></tr></thead><tbody>${userRows}</tbody></table></div><section class="settings-audit"><h3>Auditoria recente</h3><div class="settings-audit-list">${auditRows}</div></section></section>`;
    content.querySelectorAll('[data-user-edit]').forEach(button => button.addEventListener('click', () => openUserEditor(button.dataset.userEdit)));
    content.querySelectorAll('[data-user-approve]').forEach(button => button.addEventListener('click', async () => { button.disabled = true; try { await api().manageUser({ id: button.dataset.userApprove, action: 'approve' }); await showUsers('Conta aprovada com sucesso.', 'success'); } catch (error) { await showUsers(error.message || 'Não foi possível aprovar a conta.', 'error'); } }));
  }
  function closeModal() { modal.hidden = true; modal.innerHTML = ''; }
  function openUserEditor(id) {
    const user = (usersData.users || []).find(entry => entry.id === id); if (!user) return;
    modal.innerHTML = `<section class="user-editor" role="dialog" aria-modal="true" aria-label="Editar usuário"><header><div><h2>Editar usuário</h2><p>${escape(user.email)}</p></div><button class="settings-action" type="button" data-user-close>Fechar</button></header><form id="userEditorForm"><label>Nome completo<input name="fullName" required minlength="3" value="${escape(user.full_name)}"></label><label>E-mail<input name="email" type="email" required value="${escape(user.email)}"></label><label>Nova senha<input name="password" type="password" minlength="8" placeholder="Deixe em branco para manter"></label><div class="editor-row"><label>Perfil<select name="role"><option value="standard" ${user.role === 'standard' ? 'selected' : ''}>Padrão</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option></select></label><label>Situação<select name="status"><option value="pending" ${user.status === 'pending' ? 'selected' : ''}>Pendente</option><option value="active" ${user.status === 'active' ? 'selected' : ''}>Ativo</option><option value="blocked" ${user.status === 'blocked' ? 'selected' : ''}>Bloqueado</option></select></label></div><div class="editor-actions"><button type="button" class="danger" data-user-delete>Excluir</button><button type="button" data-user-close>Cancelar</button><button type="submit" class="primary">Salvar</button></div></form></section>`; modal.hidden = false;
    modal.querySelectorAll('[data-user-close]').forEach(button => button.addEventListener('click', closeModal));
    modal.querySelector('[data-user-delete]').addEventListener('click', async () => { if (!confirm(`Excluir ${user.full_name}? Esta ação remove o acesso desta conta.`)) return; try { await api().manageUser({ id: user.id, action: 'delete' }); closeModal(); await showUsers('Usuário excluído.', 'success'); } catch (error) { alert(error.message || 'Não foi possível excluir o usuário.'); } });
    modal.querySelector('#userEditorForm').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('[type="submit"]'); button.disabled = true; try { await api().manageUser({ id: user.id, ...Object.fromEntries(new FormData(form)) }); closeModal(); await showUsers('Usuário atualizado.', 'success'); } catch (error) { button.disabled = false; alert(error.message || 'Não foi possível atualizar o usuário.'); } });
  }
  tabs.forEach(button => button.addEventListener('click', () => { const section = button.dataset.settingsTab; if (section === 'general') showGeneral(); else if (section === 'security') showSecurity(); else showUsers(); }));
  document.getElementById('logoutButton').addEventListener('click', async () => { try { await api().signOut(); } finally { window.location.replace('login.html'); } });
  window.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
  (async () => { await (window.AldeckotAuthReady || Promise.resolve()); state = window.AldeckotAuth; if (!state) return; identity.textContent = `${state.profile.full_name} · ${roleName(state.profile.role)}`; if (state.isAdmin) document.querySelector('[data-admin-only]').hidden = false; showGeneral(); })();
})();
