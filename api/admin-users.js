const { audit, authenticate, normalizeName, normalizeUserCode, passwordValid, profileFor, readBody, requestSupabase, send, userCodeValid } = require('../server/supabase-admin');

const validRole = value => ['admin', 'standard'].includes(value);
const validStatus = value => ['pending', 'active', 'blocked'].includes(value);

module.exports = async (request, response) => {
  const context = await authenticate(request, response, { admin: true });
  if (!context) return;

  if (request.method === 'GET') {
    try {
      const [profiles, auditRows, authRecords] = await Promise.all([
        requestSupabase(context.config, '/rest/v1/profiles?select=id,full_name,user_code,role,status,created_at,updated_at,last_sign_in_at&order=created_at.desc'),
        requestSupabase(context.config, '/rest/v1/user_audit_logs?select=id,actor_id,target_user_id,action,details,created_at&order=created_at.desc&limit=30'),
        requestSupabase(context.config, '/auth/v1/admin/users?per_page=1000&page=1')
      ]);
      const authUsers = authRecords?.users || authRecords || [];
      const authIds = new Set(authUsers.map(user => user.id));
      const users = profiles.filter(profile => authIds.has(profile.id));
      return send(response, 200, { users, audit: auditRows });
    } catch (error) {
      return send(response, error.status || 500, { error: 'Não foi possível carregar os usuários.' });
    }
  }

  if (request.method !== 'PATCH' && request.method !== 'DELETE') return send(response, 405, { error: 'Método não permitido.' });
  const body = readBody(request);

  if (request.method === 'DELETE' && body.action === 'cleanup-legacy') {
    try {
      const [profiles, authRecords] = await Promise.all([
        requestSupabase(context.config, '/rest/v1/profiles?select=id,full_name,user_code,email,role,status'),
        requestSupabase(context.config, '/auth/v1/admin/users?per_page=1000&page=1')
      ]);
      const authIds = new Set((authRecords?.users || authRecords || []).map(user => user.id));
      const legacyProfiles = profiles.filter(profile =>
        String(profile.email || '').trim() === '' &&
        profile.full_name === 'Usuário ALDECKOT' &&
        profile.role === 'standard' &&
        profile.status === 'pending'
      );
      for (const profile of legacyProfiles) {
        if (authIds.has(profile.id)) {
          await requestSupabase(context.config, `/auth/v1/admin/users/${encodeURIComponent(profile.id)}`, { method: 'DELETE' });
        }
        await requestSupabase(context.config, `/rest/v1/profiles?id=eq.${encodeURIComponent(profile.id)}`, {
          method: 'DELETE', headers: { Prefer: 'return=minimal' }
        });
      }
      await audit(context.config, context.user.id, null, 'legacy_test_profiles_removed', { count: legacyProfiles.length });
      return send(response, 200, { removed: legacyProfiles.length });
    } catch (error) {
      return send(response, error.status || 500, { error: 'Não foi possível limpar os perfis antigos de teste.' });
    }
  }

  const targetId = String(body.id || request.query?.id || '').trim();
  if (!targetId) return send(response, 400, { error: 'Usuário não informado.' });
  if (targetId === context.user.id && request.method === 'DELETE') return send(response, 400, { error: 'O administrador não pode excluir a própria conta.' });

  try {
    const target = await profileFor(context.config, targetId);
    if (!target) return send(response, 404, { error: 'Usuário não encontrado.' });

    if (request.method === 'DELETE' || body.action === 'delete') {
      await audit(context.config, context.user.id, targetId, 'user_deleted', { userCode: target.user_code, role: target.role, status: target.status });
      await requestSupabase(context.config, `/auth/v1/admin/users/${encodeURIComponent(targetId)}`, { method: 'DELETE' });
      return send(response, 200, { message: 'Usuário excluído.' });
    }

    const cleanName = normalizeName(body.fullName ?? target.full_name);
    const cleanUserCode = normalizeUserCode(body.userCode ?? target.user_code);
    const role = body.role ?? target.role;
    const status = body.action === 'approve' ? 'active' : (body.status ?? target.status);
    const password = body.password || '';
    if (targetId === context.user.id && (role !== 'admin' || status !== 'active')) {
      return send(response, 400, { error: 'Use outra conta administradora para alterar seu próprio perfil ou bloqueio.' });
    }
    if (cleanName.length < 3 || !userCodeValid(cleanUserCode) || !validRole(role) || !validStatus(status) || (password && !passwordValid(password))) {
      return send(response, 400, { error: 'Verifique nome, código de usuário, perfil, situação e senha.' });
    }
    const authPayload = { user_metadata: { full_name: cleanName, user_code: cleanUserCode } };
    if (password) authPayload.password = password;
    await requestSupabase(context.config, `/auth/v1/admin/users/${encodeURIComponent(targetId)}`, { method: 'PUT', body: JSON.stringify(authPayload) });
    await requestSupabase(context.config, `/rest/v1/profiles?id=eq.${encodeURIComponent(targetId)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ display_name: cleanName, full_name: cleanName, user_code: cleanUserCode, role, status })
    });
    const action = body.action === 'approve' ? 'user_approved' : (status === 'blocked' && target.status !== 'blocked' ? 'user_blocked' : (status === 'active' && target.status === 'blocked' ? 'user_unblocked' : 'user_updated'));
    await audit(context.config, context.user.id, targetId, action, { changedName: cleanName !== target.full_name, changedUserCode: cleanUserCode !== target.user_code, changedRole: role !== target.role, changedStatus: status !== target.status, changedPassword: Boolean(password) });
    return send(response, 200, { message: 'Usuário atualizado.' });
  } catch (error) {
    const duplicate = /already|exists|registered|duplicate/i.test(`${error.message} ${JSON.stringify(error.body || {})}`);
    return send(response, duplicate ? 409 : (error.status || 500), { error: duplicate ? 'Este código de usuário já está em uso.' : 'Não foi possível atualizar o usuário.' });
  }
};
