const { audit, authenticate, normalizeEmail, normalizeName, passwordValid, profileFor, readBody, requestSupabase, send } = require('../server/supabase-admin');

const validRole = value => ['admin', 'standard'].includes(value);
const validStatus = value => ['pending', 'active', 'blocked'].includes(value);

module.exports = async (request, response) => {
  const context = await authenticate(request, response, { admin: true });
  if (!context) return;

  if (request.method === 'GET') {
    try {
      const [users, auditRows] = await Promise.all([
        requestSupabase(context.config, '/rest/v1/profiles?select=id,full_name,email,role,status,created_at,updated_at,last_sign_in_at&order=created_at.desc'),
        requestSupabase(context.config, '/rest/v1/user_audit_logs?select=id,actor_id,target_user_id,action,details,created_at&order=created_at.desc&limit=30')
      ]);
      return send(response, 200, { users, audit: auditRows });
    } catch (error) {
      return send(response, error.status || 500, { error: 'Não foi possível carregar os usuários.' });
    }
  }

  if (request.method !== 'PATCH' && request.method !== 'DELETE') return send(response, 405, { error: 'Método não permitido.' });
  const body = readBody(request);
  const targetId = String(body.id || request.query?.id || '').trim();
  if (!targetId) return send(response, 400, { error: 'Usuário não informado.' });
  if (targetId === context.user.id && request.method === 'DELETE') return send(response, 400, { error: 'O administrador não pode excluir a própria conta.' });

  try {
    const target = await profileFor(context.config, targetId);
    if (!target) return send(response, 404, { error: 'Usuário não encontrado.' });

    if (request.method === 'DELETE' || body.action === 'delete') {
      await audit(context.config, context.user.id, targetId, 'user_deleted', { email: target.email, role: target.role, status: target.status });
      await requestSupabase(context.config, `/auth/v1/admin/users/${encodeURIComponent(targetId)}`, { method: 'DELETE' });
      return send(response, 200, { message: 'Usuário excluído.' });
    }

    const cleanName = normalizeName(body.fullName ?? target.full_name);
    const cleanEmail = normalizeEmail(body.email ?? target.email);
    const role = body.role ?? target.role;
    const status = body.action === 'approve' ? 'active' : (body.status ?? target.status);
    const password = body.password || '';
    if (targetId === context.user.id && (role !== 'admin' || status !== 'active')) {
      return send(response, 400, { error: 'Use outra conta administradora para alterar seu próprio perfil ou bloqueio.' });
    }
    if (cleanName.length < 3 || !/^\S+@\S+\.\S+$/.test(cleanEmail) || !validRole(role) || !validStatus(status) || (password && !passwordValid(password))) {
      return send(response, 400, { error: 'Verifique nome, e-mail, perfil, situação e senha.' });
    }
    const authPayload = { email: cleanEmail, user_metadata: { full_name: cleanName } };
    if (password) authPayload.password = password;
    await requestSupabase(context.config, `/auth/v1/admin/users/${encodeURIComponent(targetId)}`, { method: 'PUT', body: JSON.stringify(authPayload) });
    await requestSupabase(context.config, `/rest/v1/profiles?id=eq.${encodeURIComponent(targetId)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ display_name: cleanName, full_name: cleanName, email: cleanEmail, role, status })
    });
    const action = body.action === 'approve' ? 'user_approved' : (status === 'blocked' && target.status !== 'blocked' ? 'user_blocked' : (status === 'active' && target.status === 'blocked' ? 'user_unblocked' : 'user_updated'));
    await audit(context.config, context.user.id, targetId, action, { changedName: cleanName !== target.full_name, changedEmail: cleanEmail !== target.email, changedRole: role !== target.role, changedStatus: status !== target.status, changedPassword: Boolean(password) });
    return send(response, 200, { message: 'Usuário atualizado.' });
  } catch (error) {
    const duplicate = /already|exists|registered|duplicate/i.test(`${error.message} ${JSON.stringify(error.body || {})}`);
    return send(response, duplicate ? 409 : (error.status || 500), { error: duplicate ? 'Este e-mail já está em uso.' : 'Não foi possível atualizar o usuário.' });
  }
};
