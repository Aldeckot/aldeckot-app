/* Apresentação compartilhada dos detalhes; dados e operações continuam nos módulos oficiais. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AldeckotEquipmentDetailView = api;
})(typeof window !== 'undefined' ? window : null, () => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const label = value => String(value ?? '').trim() || 'Não informado';
  const dateTime = value => value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : 'Não informado';
  const icons = {
    identity: '<path d="m12 2 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
    location: '<path d="M12 21s7-7 7-13a7 7 0 1 0-14 0c0 6 7 13 7 13Z"/><circle cx="12" cy="8" r="2"/>',
    trace: '<path d="M3 12a9 9 0 1 0 3-7M3 4v5h5M12 7v5l4 2"/>',
    status: '<path d="M2 12h5l3-7 4 14 3-7h5"/>',
    maintenance: '<path d="M21 3a6 6 0 0 1-8 7L5 18a2 2 0 1 1-3-3l8-8a6 6 0 0 1 7-8l-4 4 4 4 4-4Z"/>',
    class: '<path d="m12 2 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V7m-9 5v10"/>',
    note: '<path d="M5 3h14v13l-4 4H5V3Zm3 5h8m-8 4h6"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-7M3 4v5h5M12 7v5l4 2"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
  const field = (title, value, extra = '') => `<div class="eqd-field${extra ? ` ${extra}` : ''}"><span>${escape(title)}</span><b>${escape(label(value))}</b></div>`;
  const card = (title, name, body, extra = '') => `<section class="eqd-card ${extra}"><h3>${icon(name)}<span>${escape(title)}</span></h3><div class="eqd-card-body">${body}</div></section>`;
  const sourceLabel = { inventory: 'Inventário', control: 'Controle TI', flux: 'Flux', management: 'Gestão TI', supplies: 'Suprimentos' };
  const stableKey = (event, index) => String(event.id || event.eventId || `${event.module || 'log'}:${event.at || event.created_at || ''}:${index}`);
  function historyRows(item, module, shared = []) {
    const linkedIds = new Set(shared.map(entry => entry.id));
    const events = shared.map(entry => ({ id: entry.id, at: entry.created_at, module: entry.source_module,
      action: entry.action, description: entry.reason || entry.action,
      actor: entry.actor_id, beforeStatus: entry.previous_status, afterStatus: entry.new_status,
      beforeLocation: entry.previous_location || entry.origin_location,
      afterLocation: entry.new_location || entry.destination_location,
      reason: entry.reason, affected: entry.affected_modules, metadata: entry.metadata,
      sourceEventKey: entry.source_event_key, processing: entry.processing_result,
      effects: entry.effects,
      sourceId: entry.source_id }));
    const logs = (item.logs || []).filter(entry => !entry.eventId || !linkedIds.has(entry.eventId))
      .map(entry => ({ id: entry.eventId || entry.id, at: entry.createdAt || entry.at,
        module: entry.sourceModule || module, action: entry.action || 'Registro',
        description: entry.text || entry.message || 'Registro sem descrição', actor: entry.actorId || entry.ownerId }));
    return [...events, ...logs].map((entry, index) => ({ ...entry, key: stableKey(entry, index) }))
      .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  }
  function historyEntry(entry) {
    const details = [
      ['Evento', entry.id], ['Correlação', entry.sourceEventKey],
      ['Usuário', entry.actor], ['Módulo de origem', sourceLabel[entry.module] || entry.module],
      ['Operação', entry.action], ['Status anterior', entry.beforeStatus], ['Novo status', entry.afterStatus],
      ['Local anterior', entry.beforeLocation], ['Novo local', entry.afterLocation], ['Motivo', entry.reason],
      ['Módulos afetados', Array.isArray(entry.affected) ? entry.affected.join(', ') : ''],
      ['Registro de origem', entry.sourceId],
      ['Resultado por módulo', Array.isArray(entry.effects) ? entry.effects.map(effect =>
        `${sourceLabel[effect.module] || effect.module}: ${effect.status}${effect.error_message ? ` (${effect.error_message})` : ''}`).join('; ') : ''],
      ['Contexto adicional', entry.metadata && Object.keys(entry.metadata).length ? JSON.stringify(entry.metadata) : '']
    ].filter(([, value]) => value);
    return `<article class="eqd-history-entry" data-eqd-history-entry data-module="${escape(entry.module)}" data-action="${escape(entry.action)}" data-day="${escape(String(entry.at || '').slice(0, 10))}" data-actor="${escape(entry.actor || '')}"><i></i><div><time>${escape(dateTime(entry.at))}</time><strong>${escape(entry.description)}</strong><small>${escape(sourceLabel[entry.module] || entry.module || 'Origem não informada')}</small><details><summary>Detalhes do evento</summary><dl>${details.map(([key, value]) => `<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`).join('')}</dl></details></div></article>`;
  }
  const summary = rows => rows.length ? rows.slice(0, 3).map(entry =>
    `<div class="eqd-summary-row"><time>${escape(dateTime(entry.at))}</time><span>${escape(entry.description)}</span><small>${escape(sourceLabel[entry.module] || entry.module || 'Origem não informada')}</small></div>`).join('')
    : '<p class="eqd-empty">Nenhum evento registrado para este equipamento.</p>';
  function render(item, options = {}) {
    const module = options.module || 'inventory';
    const tableName = options.tableName || '';
    const rows = options.rows || historyRows(item, module);
    const operational = module === 'control' ? item.operationalStatus || item.status
      : item.status;
    const statusTone = /defeito|descart|cancel|atras|manutenç/i.test(operational || '') ? 'bad'
      : /reserva|pendente|trânsito|atenção|avaliação/i.test(operational || '') ? 'warn' : 'ok';
    const situation = module === 'control' ? item.operationalSituation || item.equipmentState?.situation || item.situation
      : module === 'flux' ? item.situation : item.situation;
    const cleaning = module === 'control' ? item.equipmentState?.cleaning_type || item.situation : item.cleaning;
    const location = item.location || item.equipmentState?.location || '';
    const identification = card('Identificação', 'identity',
      `<div class="eqd-fields">${field('Marca', item.brand)}${field('Modelo', item.model)}${field('Categoria', tableName)}${field('Tipo', module === 'flux' ? item.movement : module === 'control' ? item.followUpKind === 'verification' ? 'Verificação' : 'Manutenção' : 'Equipamento')}${module === 'inventory' ? field('Limpeza', cleaning) : ''}</div>`);
    const locationCard = card('Localização e Vínculo', 'location',
      `<div class="eqd-fields">${field('Setor', item.sector)}${field('Local', location)}${field('Vínculo', item.inventoryItemId ? `Inventário · ${item.inventoryItemId}` : item.managementRecordId ? 'Gestão TI' : item.sourceModule ? sourceLabel[item.sourceModule] || item.sourceModule : 'Sem vínculo confirmado', 'eqd-wide')}</div>`);
    const trace = card('Rastreabilidade', 'trace',
      `<div class="eqd-fields">${field('Tempo no status', 'Sem transição datada', 'eqd-status-time')}${field('Última movimentação', 'Sem movimentação confirmada', 'eqd-last-movement')}</div>`);
    const statusCard = card('Status Operacional', 'status',
      `<div class="eqd-fields">${field('Estado atual', operational, 'eqd-status-value')}${field('Última atualização', dateTime(item.updatedAt || item.date))}</div>`);
    const maintenance = card('Manutenção', 'maintenance',
      `<button class="eqd-card-link" type="button" data-eqd-view="maintenance"><span data-eqd-maintenance>Consultar registros e pendências no Controle TI</span><b aria-hidden="true">›</b></button>`, 'eqd-maintenance-card');
    const classification = card('Classificação', 'class',
      `<div class="eqd-fields">${field(module === 'flux' ? 'Motivo' : 'Situação', situation)}${field('Prioridade', item.priority || (module === 'inventory' ? 'Estável' : 'Não informada'))}${module === 'control' ? field('Limpeza', cleaning) : ''}</div>`);
    const notes = card('Observações', 'note', `<p class="eqd-notes">${escape(item.notes || 'Sem observações no momento.')}</p>`);
    const recent = card('Histórico Resumido', 'history', `<div data-eqd-summary>${summary(rows)}</div>`);
    return `<div class="eqd-root" data-eqd-root>
      <header class="eqd-titlebar"><div class="eqd-brand" aria-label="Aldeckot"><img class="eqd-brand-logo" src="assets/aldeckot-symbol.png?v=2.0.73" alt=""><b>Aldeckot</b></div><span class="eqd-title-divider"></span><h2>Detalhes do Equipamento</h2><button type="button" class="eqd-close" data-inv-close aria-label="Fechar detalhes">×</button></header>
      <div class="eqd-screen" data-eqd-screen="detail"><div class="eqd-hero"><div class="eqd-photo"><span class="eqd-photo-placeholder" aria-hidden="true">◇</span><img data-eqd-photo${options.imageKey ? ` data-inv-image-key="${escape(options.imageKey)}"` : ''} alt="Fotografia de ${escape(item.equipment)}" hidden>${options.canManage ? '<div class="eqd-photo-tools"><button type="button" data-eqd-photo-choose aria-label="Adicionar ou substituir fotografia">✎</button><button type="button" data-eqd-photo-remove aria-label="Remover fotografia" hidden>×</button><input data-eqd-photo-input type="file" accept="image/png,image/jpeg,image/webp" hidden></div>' : ''}</div><div class="eqd-hero-copy"><span class="eqd-hero-status eqd-tone-${statusTone}">● ${escape(label(operational))}</span><h2>${escape(label(item.equipment))}</h2><p>${escape([item.brand, item.model].filter(Boolean).join(' · ') || tableName || 'Equipamento cadastrado')}</p><div class="eqd-identity"><span>TAG: <b>${escape(label(item.tag))}</b></span><span>Nº de série: <b>${escape(label(item.serial))}</b></span></div></div><div class="eqd-hero-actions"><button type="button" data-eqd-view="history">${icon('history')} Histórico</button>${options.actions || ''}</div></div>
      <div class="eqd-columns"><div class="eqd-column">${identification}${locationCard}${trace}</div><div class="eqd-column">${statusCard}${maintenance}${classification}${notes}${recent}</div></div><div class="eqd-extras" data-eqd-extras></div>
      <footer class="eqd-footer"><span>ⓘ</span> Movimentações, alterações e manutenções confirmadas permanecem no histórico do equipamento.</footer></div>
      <div class="eqd-screen" data-eqd-screen="history" hidden><div class="eqd-view-head"><button type="button" data-eqd-view="detail">← Voltar aos detalhes</button><div><h2>Histórico do equipamento</h2><p>${escape(label(item.equipment))} · ${escape(label(item.tag || item.serial))}</p></div></div><div class="eqd-history-filters"><label>Módulo<select data-eqd-history-module><option value="">Todos os módulos</option></select></label><label>Evento<select data-eqd-history-action><option value="">Todos os eventos</option></select></label><label>Período<input type="month" data-eqd-history-month></label><label>Usuário<input type="search" data-eqd-history-actor placeholder="Identificador do usuário"></label></div><div class="eqd-history-list" data-eqd-history-list>${rows.length ? rows.map(historyEntry).join('') : '<p class="eqd-empty">Nenhum evento registrado.</p>'}</div><details class="eqd-legacy-details"><summary>Registros complementares do módulo</summary><div data-eqd-legacy></div></details></div>
      <div class="eqd-screen" data-eqd-screen="maintenance" hidden><div class="eqd-view-head"><button type="button" data-eqd-view="detail">← Voltar aos detalhes</button><div><h2>Manutenção do equipamento</h2><p>Registros oficiais do Controle TI</p></div></div><div data-eqd-maintenance-list role="status">Consultando chamados vinculados…</div></div>
      <div class="eqd-screen" data-eqd-screen="edit" hidden><div data-eqd-editor></div></div>
    </div>`;
  }
  return { render, historyRows, historyEntry, summary, dateTime };
});
