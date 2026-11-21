/* Central Operacional: apresenta somente casos reais vindos das RPCs 097. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AldeckotControlOperational = api;
})(typeof window !== 'undefined' ? window : null, () => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const states = ['Aberto','Em verificação','Em diagnóstico','Em manutenção',
    'Aguardando peça','Aguardando fornecedor','Aguardando retorno','Aguardando teste',
    'Resolvido','Concluído','Cancelado'];
  const date = value => value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}) : '—';
  const priorityTone = value => ({'Crítica':'critical','Alta':'high','Média':'medium','Baixa':'low'})[value] || 'stable';
  const age = hours => Number.isFinite(Number(hours))
    ? Number(hours) < 24 ? `${Math.max(0,Number(hours))} h` : `${Math.floor(Number(hours)/24)} d`
    : '—';
  const target = row => row.tableId && row.controlItemId
    ? `control.html?table=${encodeURIComponent(row.tableId)}&item=${encodeURIComponent(row.controlItemId)}&case=${encodeURIComponent(row.caseId || row.id)}`
    : '';
  const link = (row,label='Abrir chamado') => target(row)
    ? `<a class="control-case-link" href="${escape(target(row))}">${escape(label)}</a>`
    : '<span class="control-case-unlinked">Vínculo em revisão</span>';
  const metric = (name,value,caption,tone='') =>
    `<article class="control-op-metric ${tone}"><span>${escape(name)}</span><strong>${escape(value)}</strong><small>${escape(caption)}</small></article>`;
  function metrics(summary) {
    const m=summary?.metrics || {};
    return `<div class="control-op-metrics control-op-dashboard-metrics" aria-label="Indicadores de chamados">
      ${metric('Abertos',m.open ?? '—','Casos ainda não encerrados','open')}
      ${metric('Em verificação',m.verification ?? '—','Estado técnico atual','verify')}
      ${metric('Em manutenção',m.maintenance ?? '—','Chamados em reparo','maintenance')}
      ${metric('Aguardando peça/fornecedor',m.waiting ?? '—','Inclui aguardando retorno','waiting')}
      ${metric('Aguardando teste',m.testing ?? '—','Validação técnica pendente','testing')}
      ${metric('Críticos',m.critical ?? '—','Prioridade Alta/Crítica e não encerrados','critical')}
      ${summary?.tasksAvailable ? metric('Pendências vencidas',m.overdue ?? 0,
        'Tarefas abertas além do prazo','overdue') : ''}
      ${metric('Concluídos no período',m.completedPeriod ?? '—',
        summary?.periodStart ? `Desde ${summary.periodStart}` : 'Período atual','completed')}
      ${metric('Tempo médio de resolução',
        m.avgResolutionHours == null ? '—' : `${m.avgResolutionHours} h`,
        m.avgResolutionHours == null ? 'Sem resoluções no período' : 'Da abertura até a solução','average')}
    </div>`;
  }
  const queueRow = row => `<tr><td><b>${escape(row.equipment || 'Equipamento')}</b><small>${escape(row.tag || 'Sem TAG')} · ${escape(row.sector || 'Setor não informado')}</small></td>
    <td><span class="control-op-priority ${priorityTone(row.priority)}">${escape(row.priority || 'Média')}</span></td>
    <td>${escape(row.state || 'A revisar')}</td><td>${escape(age(row.ageHours))}</td><td>${link(row)}</td></tr>`;
  const activityRow = row => `<li><div><b>${escape(row.equipment || 'Chamado')}</b><span>${escape(row.state || 'Atualização')} · ${escape(row.reason || 'Sem detalhe')}</span></div><time>${escape(date(row.created_at))}</time>${link(row,'Ver')}</li>`;
  const interventionRow = row => `<li><div><b>${escape(row.equipment || 'Chamado')} · ${escape(row.type || 'Intervenção')}</b><span>${escape(row.description || 'Sem descrição')}</span></div><time>${escape(date(row.occurred_at))}</time>${link(row,'Ver')}</li>`;
  const overdueRow = row => `<li><div><b>${escape(row.equipment || 'Chamado')} · ${escape(row.description)}</b><span>${escape(row.state)} · Prioridade ${escape(row.priority)}</span></div><time>Venceu: ${escape(date(row.due_at))}</time>${link(row,'Ver')}</li>`;
  function overview(state) {
    if (state.busy && !state.dashboard) return '<p class="control-op-loading" role="status">Carregando indicadores reais…</p>';
    const summary=state.dashboard;
    if (!summary) return '<p class="control-op-empty">Indicadores indisponíveis no momento.</p>';
    const queue=summary.queue || [];
    const activity=summary.activity || [];
    const interventions=summary.interventions || [];
    const overdueTasks=summary.overdueTasks || [];
    return `<section class="control-op-dashboard-section"><div class="control-op-section-heading"><div><span>ACOMPANHAMENTO</span><h2>Panorama dos chamados</h2></div><p>Indicadores calculados a partir dos chamados registrados.</p></div>${metrics(summary)}</section>
      <div class="control-op-overview-grid">
        <section class="control-op-card control-op-queue"><header><div><h2>Fila de trabalho</h2><p>Prioridade e antiguidade dos chamados abertos</p></div><button type="button" data-control-tab="active">Ver em andamento</button></header>
          <div class="control-op-table-wrap"><table><thead><tr><th>Equipamento</th><th>Prioridade</th><th>Estado</th><th>Idade</th><th>Acesso</th></tr></thead><tbody>${queue.length ? queue.map(queueRow).join('') : '<tr><td colspan="5" class="control-op-empty">Nenhum chamado aberto.</td></tr>'}</tbody></table></div>
        </section>
        <div class="control-op-feed">
        <section class="control-op-card"><header><div><h2>Atividade recente</h2><p>Mudanças de estado; não são intervenções</p></div></header>
          ${activity.length ? `<ul class="control-op-activity">${activity.map(activityRow).join('')}</ul>` : '<p class="control-op-empty">Nenhuma mudança de estado recente.</p>'}
        </section>
        <section class="control-op-card${summary.interventionsAvailable ? '' : ' control-op-unavailable'}"><h2>Intervenções recentes</h2>${summary.interventionsAvailable
          ? interventions.length ? `<ul class="control-op-activity">${interventions.map(interventionRow).join('')}</ul>`
            : '<p class="control-op-empty">Nenhuma intervenção formal registrada.</p>'
          : '<p>Registro formal indisponível até a migração 099. Mudanças de estado não são intervenções.</p>'}</section>
        <section class="control-op-card${summary.tasksAvailable ? '' : ' control-op-unavailable'}"><h2>Pendências vencidas</h2>${summary.tasksAvailable
          ? overdueTasks.length ? `<ul class="control-op-activity">${overdueTasks.map(overdueRow).join('')}</ul>`
            : '<p class="control-op-empty">Nenhuma pendência vencida.</p>'
          : '<p>Registro de tarefas e prazos indisponível até a migração 100; nenhum vencimento é presumido.</p>'}</section></div>
      </div>`;
  }
  const filterOptions = (values,selected) => values.map(value =>
    `<option value="${escape(value)}"${selected===value?' selected':''}>${escape(value)}</option>`).join('');
  function listing(state) {
    const page=state.listing || {items:[],total:0,page:state.page,pageSize:state.pageSize};
    const rows=page.items || [];
    const pages=Math.max(1,Math.ceil(Number(page.total || 0)/Number(state.pageSize || 25)));
    return `<section class="control-op-card control-op-list">
      <div class="control-op-filters"><label><span>Buscar chamados</span><input data-control-query value="${escape(state.query)}" maxlength="100" placeholder="Equipamento, TAG, série, setor ou tabela" autocomplete="off"></label>
      <label><span>Estado</span><select data-control-state><option value="">Todos os estados</option>${filterOptions(states,state.status)}</select></label>
      <label><span>Prioridade</span><select data-control-priority><option value="">Todas</option>${filterOptions(['Crítica','Alta','Média','Baixa'],state.priority)}</select></label>
      <label><span>Por página</span><select data-control-page-size>${filterOptions(['10','25','50','100'],String(state.pageSize))}</select></label></div>
      ${state.busy ? '<p class="control-op-loading" role="status">Atualizando chamados…</p>' : ''}
      <div class="control-op-table-wrap"><table><thead><tr><th>Equipamento</th><th>TAG / Série</th><th>Tabela</th><th>Estado</th><th>Prioridade</th><th>Aberto em</th><th>Acesso</th></tr></thead>
      <tbody>${rows.length ? rows.map(row=>`<tr><td><b>${escape(row.equipment || 'Equipamento')}</b><small>${escape(row.sector || 'Setor não informado')}</small></td><td>${escape(row.tag || '—')}<small>${escape(row.serial || '—')}</small></td><td>${escape(row.table_name || '—')}</td><td>${escape(row.ticket_state || 'A revisar')}</td><td><span class="control-op-priority ${priorityTone(row.priority)}">${escape(row.priority || 'Média')}</span></td><td>${escape(date(row.opened_at))}</td><td>${link({ ...row,tableId:row.table_id,controlItemId:row.control_item_id })}</td></tr>`).join('') : '<tr><td colspan="7" class="control-op-empty">Nenhum chamado encontrado para estes filtros.</td></tr>'}</tbody></table></div>
      <footer class="control-op-pagination"><span>${escape(page.total || 0)} chamados · página ${escape(state.page)} de ${pages}</span><div><button type="button" data-control-page="${state.page-1}"${state.page<=1?' disabled':''} aria-label="Página anterior">‹</button><button type="button" data-control-page="${state.page+1}"${state.page>=pages?' disabled':''} aria-label="Próxima página">›</button></div></footer>
    </section>`;
  }
  const categories=['Alimentação elétrica','Conectividade / rede','Armazenamento','Memória / desempenho','Vídeo / tela','Periféricos','Sistema / software','Refrigeração','Mecânica / estrutura','Outro'];
  function reportChart(title,items=[],suffix='') {
    const rows=Array.isArray(items)?items:[];
    const max=Math.max(1,...rows.map(item=>Number(item.count)||0));
    return `<section class="control-op-card control-report-chart"><h2>${escape(title)}</h2>${rows.length?rows.slice(0,8).map(item=>`<div class="control-report-bar"><span>${escape(item.label||'Não informado')}</span><i><b style="width:${Math.max(2,Math.min(100,(Number(item.count)||0)*100/max))}%"></b></i><strong>${escape(item.count||0)}${suffix}</strong></div>`).join(''):'<p class="control-op-empty">Sem dados para os filtros.</p>'}</section>`;
  }
  function reporting(state) {
    const f=state.reportFilters||{}; const report=state.report;
    const metrics=report?.metrics||{};
    const metricHtml=[['Chamados',metrics.cases??'—'],['Resolvidos',`${metrics.resolvedCases??'—'} (${metrics.resolutionRate??0}%)`],['Tempo médio até resolução',metrics.avgResolutionHours==null?'—':`${metrics.avgResolutionHours} h`],['Manutenção média',metrics.avgMaintenanceMinutes==null?'—':`${metrics.avgMaintenanceMinutes} min`],['Reincidências',metrics.recurrences??'—'],['Pendências vencidas',metrics.overdueTasks??'—']].map(([label,value])=>`<article class="control-op-metric"><span>${escape(label)}</span><strong>${escape(value)}</strong></article>`).join('');
    const rows=report?.casesList||[];
    return `<section class="control-op-report">
      <div class="control-op-card"><header><div><h2>Filtros do relatório</h2><p>Indicadores de casos distintos; intervenções são apresentadas separadamente.</p></div><div class="control-report-actions"><button type="button" data-control-export-csv${report?'':' disabled'}>Exportar CSV</button><button type="button" data-control-export-pdf${report?'':' disabled'}>Imprimir / PDF</button></div></header>
      <div class="control-op-filters control-report-filters">
        <label><span>De</span><input type="date" data-report-filter="periodStart" value="${escape(f.periodStart||'')}"></label><label><span>Até</span><input type="date" data-report-filter="periodEnd" value="${escape(f.periodEnd||'')}"></label>
        <label><span>Setor</span><input data-report-filter="sector" value="${escape(f.sector||'')}" placeholder="Todos"></label>
        <label><span>Categoria da falha</span><select data-report-filter="category"><option value="">Todas</option>${filterOptions(categories,f.category)}</select></label>
        <label><span>Estado</span><select data-report-filter="state"><option value="">Todos</option>${filterOptions(states,f.state)}</select></label>
        <label><span>Prioridade</span><select data-report-filter="priority"><option value="">Todas</option>${filterOptions(['Crítica','Alta','Média','Baixa','Estável'],f.priority)}</select></label>
        <label><span>Origem</span><select data-report-filter="origin"><option value="">Todas</option>${[['control','Controle TI'],['inventory','Inventário'],['management','Gestão TI'],['supplies','Suprimentos']].map(([value,label])=>`<option value="${value}"${f.origin===value?' selected':''}>${label}</option>`).join('')}</select></label>
        <label><span>Manutenção</span><select data-report-filter="maintenanceMode">${[['all','Interna e externa'],['internal','Interna'],['external','Externa']].map(([v,l])=>`<option value="${v}"${(f.maintenanceMode||'all')===v?' selected':''}>${l}</option>`).join('')}</select></label>
      </div>${state.busy?'<p class="control-op-loading" role="status">Atualizando relatório…</p>':''}</div>
      ${report?`<div class="control-op-metrics control-report-metrics">${metricHtml}</div><div class="control-report-charts">${reportChart('Estados',report.states)}${reportChart('Evolução diária',report.timeline)}${reportChart('Setores',report.sectors)}${reportChart('Tipos de falha',report.categories)}${reportChart('Origem',report.origins)}${reportChart('Tempo médio de resolução por setor',report.resolutionTimes,' h')}</div>
      <section class="control-op-card"><header><div><h2>Chamados no período</h2><p>${escape(rows.length)} registros · intervenções listadas à parte</p></div></header>${report.truncated?'<p class="control-op-error">Exibição limitada aos primeiros 5.000 chamados; reduza o período para exportação completa.</p>':''}<div class="control-op-table-wrap"><table><thead><tr><th>Equipamento</th><th>Setor</th><th>Estado</th><th>Categoria</th><th>Manutenção</th><th>Intervenções</th><th>Recorrência</th><th>PDF</th></tr></thead><tbody>${rows.length?rows.map(row=>`<tr><td><b>${escape(row.equipment||'Equipamento')}</b><small>${escape(row.tag||'—')} · ${escape(date(row.openedAt))}</small></td><td>${escape(row.sector||'—')}</td><td>${escape(row.state||'—')}</td><td>${escape(row.category||'—')}</td><td>${escape(row.maintenanceMinutes??0)} min</td><td>${escape(row.interventions??0)}</td><td>${row.recurrence?'Sim':'Não'}</td><td><button type="button" data-report-print-id="${escape(row.id)}" aria-label="Imprimir ficha do chamado">Imprimir</button></td></tr>`).join(''):'<tr><td colspan="8" class="control-op-empty">Nenhum chamado encontrado para estes filtros.</td></tr>'}</tbody></table></div></section>`:''}
      </section>`;
  }
  function markup(state) {
    const tabs=[['overview','Visão operacional'],['reports','Relatórios'],['all','Todos'],['active','Em andamento'],['history','Histórico']];
    const views = {
      overview: ['VISÃO GERAL', 'Central Operacional', 'Acompanhe prioridades, chamados e intervenções em um só lugar.'],
      reports: ['RELATÓRIOS', 'Relatórios de manutenção', 'Analise os chamados e exporte os resultados do período.'],
      all: ['CHAMADOS', 'Todos os chamados', 'Consulte e filtre os chamados registrados.'],
      active: ['CHAMADOS', 'Em andamento', 'Acompanhe os casos que ainda precisam de atenção.'],
      history: ['CHAMADOS', 'Histórico de chamados', 'Revise os casos encerrados e suas informações.']
    };
    const [section, title, description] = views[state.tab] || views.overview;
    return `<div class="control-operational" data-control-operational>
      <div class="control-op-heading"><div class="control-op-heading-copy"><span class="control-op-eyebrow">CONTROLE TI / ${section}</span><h1>${title}</h1><p>${description}</p></div><div class="control-op-heading-actions">${state.tab === 'overview' ? '<button type="button" data-control-tab="active">Ver em andamento</button><button type="button" data-control-tab="reports">Abrir relatórios</button>' : ''}<button type="button" data-control-refresh title="Atualizar indicadores e chamados">↻ Atualizar</button></div></div>
      <nav class="control-op-tabs" aria-label="Visões do Controle TI">${tabs.map(([key,label])=>`<button type="button" data-control-tab="${key}" aria-selected="${state.tab===key}">${label}</button>`).join('')}</nav>
      ${state.error ? `<p class="control-op-error" role="alert">${escape(state.error)}</p>` : ''}
      ${state.tab==='overview' ? overview(state) : state.tab==='reports' ? reporting(state) : listing(state)}
    </div>`;
  }
  return { markup,metrics,listing,overview,reporting,reportChart,target };
});
