import { anonymousReadBlocked, protectedTables } from './rls-check.mjs';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!url || !publishableKey) {
  throw new Error('Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY para validar a RLS.');
}

const endpoint = url.replace(/\/+$/, '');

for (const table of protectedTables) {
  const response = await fetch(`${endpoint}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: publishableKey }
  });
  const payload = await response.json().catch(() => null);
  if (!anonymousReadBlocked(response.status, payload)) {
    if (!response.ok) throw new Error(`Não foi possível verificar ${table}: HTTP ${response.status}, código ${payload?.code || 'desconhecido'}.`);
    if (!Array.isArray(payload)) throw new Error(`Resposta inesperada ao consultar ${table}; a proteção não foi confirmada.`);
    throw new Error(`A RLS de ${table} permitiu leitura anônima. Interrompa a publicação e revise as políticas.`);
  }
  console.log(`✓ ${table}: leitura anônima bloqueada.`);
}

console.log('VALIDAÇÃO RLS CONCLUÍDA: as tabelas corporativas não expõem registros para acesso anônimo.');
