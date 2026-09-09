const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const maxAgeHours = Number(process.env.ALDECKOT_BACKUP_MAX_AGE_HOURS || 168);

if (!url || !serviceRoleKey) {
  throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para validar os backups.');
}
if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) throw new Error('ALDECKOT_BACKUP_MAX_AGE_HOURS deve ser maior que zero.');

const endpoint = url.replace(/\/+$/, '');
const tables = ['inventory_backups', 'control_backups', 'flux_backups', 'management_backups', 'nfe_backups'];

for (const table of tables) {
  const response = await fetch(`${endpoint}/rest/v1/${table}?select=created_at&order=created_at.desc&limit=1`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }
  });
  if (!response.ok) throw new Error(`Não foi possível consultar o backup de ${table}: ${response.status}.`);
  const [latest] = await response.json();
  if (!latest?.created_at) throw new Error(`Não existe backup disponível para ${table}.`);
  const ageHours = (Date.now() - new Date(latest.created_at).getTime()) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours > maxAgeHours) {
    throw new Error(`O backup de ${table} está vencido (${ageHours.toFixed(1)}h; limite ${maxAgeHours}h).`);
  }
  console.log(`✓ ${table}: último backup há ${ageHours.toFixed(1)}h.`);
}

console.log('VALIDAÇÃO DE BACKUPS CONCLUÍDA: todos os módulos possuem cópia recente.');
