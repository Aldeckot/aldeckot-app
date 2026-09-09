const { ensureConfig, requestSupabase, send } = require('../server/supabase-admin');

const pad = value => String(value).padStart(2, '0');
const isoDate = value => `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
const monthLabel = period => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(new Date(`${period}T12:00:00Z`)).replace(/^./, char => char.toUpperCase());
const plain = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\\()]/g, char => `\\${char}`).replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
const pdfLines = (title, lines) => {
  const pages = [];
  const all = [title, '', ...lines];
  while (all.length) pages.push(all.splice(0, 42));
  const objects = new Map();
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(2, `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((page, index) => {
    const pageId = pageIds[index]; const contentId = pageId + 1;
    const body = ['BT', '/F1 10 Tf', '52 796 Td', ...page.map((line, lineIndex) => `${lineIndex ? '0 -17 Td' : ''} (${plain(line).slice(0, 125)}) Tj`).filter(Boolean), 'ET'].join('\n');
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.set(contentId, `<< /Length ${Buffer.byteLength(body, 'utf8')} >>\nstream\n${body}\nendstream`);
  });
  const count = Math.max(...objects.keys()); let output = '%PDF-1.4\n'; const offsets = [0];
  for (let id = 1; id <= count; id += 1) { offsets[id] = Buffer.byteLength(output, 'utf8'); output += `${id} 0 obj\n${objects.get(id)}\nendobj\n`; }
  const xref = Buffer.byteLength(output, 'utf8'); output += `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= count; id += 1) output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  return Buffer.from(`${output}trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`, 'utf8');
};
const storagePath = path => path.split('/').map(encodeURIComponent).join('/');
const textForEvent = event => {
  const details = event.details || {};
  const module = { inventory: 'Inventário', management: 'Gestão TI', control: 'Controle TI', flux: 'Flux', nfe: 'Fiscal NF-e' }[event.module] || event.module || 'Módulo';
  return `${event.created_at || ''} | ${module} | ${details.description || details.equipment || event.operation || 'Atualização registrada.'}`;
};

module.exports = async (request, response) => {
  if (request.method !== 'GET') return send(response, 405, { error: 'Método não permitido.' });
  const secret = String(process.env.CRON_SECRET || '');
  if (!secret || request.headers.authorization !== `Bearer ${secret}`) return send(response, 401, { error: 'Rotina mensal não autorizada.' });
  const config = ensureConfig(response); if (!config) return;
  try {
    const fetchAll = async path => {
      const rows = []; const size = 1000;
      for (let offset = 0; ; offset += size) {
        const page = await requestSupabase(config, `${path}&limit=${size}&offset=${offset}`);
        rows.push(...(page || []));
        if (!page || page.length < size) return rows;
      }
    };
    const localParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const currentYear = Number(localParts.find(part => part.type === 'year').value);
    const currentMonth = Number(localParts.find(part => part.type === 'month').value);
    const periodStartDate = new Date(Date.UTC(currentYear, currentMonth - 2, 1));
    const nextMonthDate = new Date(Date.UTC(currentYear, currentMonth - 1, 1));
    const periodStart = isoDate(periodStartDate); const nextMonth = isoDate(nextMonthDate);
    const cutoff = isoDate(new Date(Date.UTC(currentYear, currentMonth - 1, 0)));
    const rangeStart = `${periodStart}T00:00:00.000Z`; const rangeEnd = `${nextMonth}T00:00:00.000Z`;
    const [agendaEntries, activities] = await Promise.all([
      fetchAll(`/rest/v1/agenda_entries?select=id,kind,title,due_date,completed_at&is_completed=eq.true&completed_at=gte.${encodeURIComponent(rangeStart)}&completed_at=lt.${encodeURIComponent(rangeEnd)}&order=completed_at.desc`),
      fetchAll(`/rest/v1/sync_events?select=id,module,operation,details,created_at&operation=in.(create,update,delete,log)&created_at=gte.${encodeURIComponent(rangeStart)}&created_at=lt.${encodeURIComponent(rangeEnd)}&order=created_at.desc`)
    ]);
    const summary = { period: periodStart.slice(0, 7), cutoff, completed: agendaEntries.length, activities: activities.length, finalizedBy: 'cron' };
    const lines = [
      `Período apurado: ${monthLabel(periodStart)} (${periodStart} a ${cutoff})`,
      `Tarefas e eventos concluídos: ${agendaEntries.length}`,
      `Atualizações em módulos: ${activities.length}`,
      '', 'TAREFAS E EVENTOS CONCLUÍDOS',
      ...(agendaEntries.length ? agendaEntries.map(entry => `${entry.completed_at || ''} | ${entry.kind === 'event' ? 'Evento' : 'Tarefa'} | ${entry.title}`) : ['Nenhum registro concluído no período.']),
      '', 'ALTERAÇÕES NOS MÓDULOS',
      ...(activities.length ? activities.map(textForEvent) : ['Nenhuma alteração registrada no período.'])
    ];
    const pdf = pdfLines(`ALDECKOT - Relatório mensal de auditoria - ${monthLabel(periodStart)}`, lines);
    const fileName = `auditoria-${periodStart.slice(0, 7)}-final.pdf`; const pdfPath = `finalizados/${periodStart.slice(0, 4)}/${periodStart.slice(5, 7)}/${fileName}`;
    const upload = await fetch(`${config.url}/storage/v1/object/audit-reports/${storagePath(pdfPath)}`, { method: 'POST', headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: pdf });
    if (!upload.ok) throw new Error('Não foi possível armazenar o PDF mensal.');
    const reports = await requestSupabase(config, '/rest/v1/monthly_audit_reports?on_conflict=period_start,cutoff_date', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ period_start: periodStart, cutoff_date: cutoff, status: 'finalized', summary, pdf_path: pdfPath, pdf_name: fileName, pdf_size: pdf.length }) });
    return send(response, 200, { finalized: true, period: periodStart.slice(0, 7), report: reports?.[0] || null });
  } catch (error) {
    return send(response, error.status || 500, { error: error.message || 'Não foi possível finalizar a auditoria mensal.' });
  }
};
