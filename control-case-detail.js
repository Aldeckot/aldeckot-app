/* Detalhe de uma ocorrência técnica; não mistura outros episódios do equipamento. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AldeckotControlCaseDetail = api;
})(typeof window !== 'undefined' ? window : null, () => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const date = value => value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toLocaleString('pt-BR',{ dateStyle:'short', timeStyle:'short' }) : '—';
  const tabs = [
    ['overview','Visão Geral'],['diagnosis','Diagnóstico'],['interventions','Intervenções'],
    ['pending','Pendências'],['components','Componentes'],['movements','Movimentações'],
    ['history','Histórico']
  ];
  const fields = [
    ['symptom','Sintoma'],['hypothesis','Hipótese'],['tests','Testes'],
    ['results','Resultados'],['cause','Causa'],['final_diagnosis','Diagnóstico final']
  ];
  const description = value => String(value || '').replace(
    /^\[\[aldeckot:item-priority:(alta|media|estavel)\]\]\r?\n?/i, '');
  const interventionTypes = ['Inspeção','Diagnóstico','Limpeza','Configuração',
    'Atualização','Reparo','Troca de componente','Teste funcional',
    'Teste de estabilidade','Envio externo','Retorno','Outro'];
  const failureCategories=['Alimentação elétrica','Conectividade / rede','Armazenamento',
    'Memória / desempenho','Vídeo / tela','Periféricos','Sistema / software',
    'Refrigeração','Mecânica / estrutura','Outro'];
  const localDateTime = () => {
    const now = new Date();
    return new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);
  };
  const dateInput = value => value && !Number.isNaN(Date.parse(value))
    ? new Date(new Date(value).getTime()-new Date(value).getTimezoneOffset()*60000)
      .toISOString().slice(0,16) : '';
  const elapsed = value => {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    const minutes = Math.max(0, Math.floor(Number(value)));
    const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60);
    return days ? days+' d '+hours+' h' : hours+' h '+(minutes % 60)+' min';
  };
  const openTasks = data => (data.tasks || []).filter(t =>
    ['Pendente','Em andamento'].includes(t.task_state));
  const nextTask = data => [...openTasks(data)].sort((a,b)=>
    (a.due_at ? Date.parse(a.due_at) : Infinity)-
    (b.due_at ? Date.parse(b.due_at) : Infinity))[0];
  const field = (label,value) => `<div class="control-case-field"><span>${escape(label)}</span><b>${escape(value || '—')}</b></div>`;
  const unavailable = (title,detail) => `<div class="control-case-empty"><b>${escape(title)}</b><p>${escape(detail)}</p></div>`;
  function overview(data,canEdit) {
    const c=data.case || {}, i=data.item || {};
    const duration=data.duration || {};
    const end=c.closed_at || Date.now();
    const hours=c.opened_at ? Math.max(0,Math.floor((new Date(end)-new Date(c.opened_at))/36e5)) : null;
    const next=nextTask(data);
    const priorityOptions=['Baixa','Média','Alta','Crítica'].map(value=>
      '<option'+(value===(duration.priorityLevel || 'Média')?' selected':'')+'>'+escape(value)+'</option>').join('');
    const priorityForm=canEdit && !['Concluído','Cancelado'].includes(c.ticket_state)
      ? '<form data-control-case-priority class="control-case-priority"><label><span>Prioridade do chamado</span><select name="priority">'
        +priorityOptions+'</select></label><button type="submit" class="inv-primary">Salvar prioridade</button>'
        +'<p>Prioridade não altera a severidade calculada pelo tempo em manutenção.</p></form>' : '';
    const reopenForm=canEdit && c.ticket_state==='Resolvido'
      ? '<form data-control-case-reopen class="control-case-reopen"><h3>Reabrir chamado</h3>'
        +'<p>A reabertura volta para Em diagnóstico e preserva esta ocorrência e seu histórico.</p>'
        +'<label><span>Motivo da reabertura *</span><textarea name="reason" minlength="3" maxlength="2000" required></textarea></label>'
        +'<button type="submit" class="inv-primary">Reabrir para diagnóstico</button></form>' : '';
    const resolution=(data.resolutions || [])[0];
    const resolutionRecord=resolution ? `<section class="control-case-resolution-record"><h3>Resolução registrada</h3>
      <div class="control-case-fields">${field('Diagnóstico final',resolution.final_diagnosis)}
      ${field('Solução aplicada',resolution.solution)}${field('Testes realizados',resolution.tests)}
      ${field('Categoria técnica',resolution.failure_category)}
      ${field('Condição final confirmada',resolution.final_condition)}${field('Registrada em',date(resolution.created_at))}
      <div class="control-case-field wide"><span>Observações</span><b>${escape(resolution.observations || '—')}</b></div></div></section>` : '';
    const recurrence=data.recurrence;
    const recurrencePanel=!data.recurrenceAvailable
      ? '<section class="control-case-recurrence"><h3>Reincidência</h3><p>Disponível após aplicar a migração 105.</p></section>'
      : !recurrence?.available
        ? `<section class="control-case-recurrence"><h3>Reincidência</h3><p>${escape(recurrence?.reason || 'Não foi possível confirmar a identidade estável.')}</p></section>`
        : `<section class="control-case-recurrence"><h3>Histórico do equipamento · ${escape(recurrence.occurrenceCount || 0)} ocorrência(s)</h3>
          <p class="control-case-recurrence-note">Agrupado pelo ID estável da origem (${escape(recurrence.sourceModule)}). TAG e série não são usadas para unir históricos.</p>
          ${(recurrence.categories || []).length ? (recurrence.categories || []).map(group=>`<article class="control-case-recurrence-category${group.occurrences>=2?' is-likely':''}">
            <b>${group.occurrences>=2?'Possível reincidência':'Categoria registrada'} · ${escape(group.category)} · ${escape(group.occurrences)} ocorrência(s)</b>
            ${group.occurrences>=2?`<p>Indício determinístico: mesmo equipamento de origem e mesma categoria técnica estruturada. Intervalo médio entre resoluções: ${escape(group.averageIntervalDays ?? '—')} dia(s). Não é diagnóstico automático.</p>`:''}
            <ul>${(group.references || []).map(ref=>`<li>Chamado ${escape(ref.caseId)} · ${escape(ref.state || 'A revisar')} · ${escape(date(ref.openedAt))}${ref.intervalDays!=null?` · intervalo ${escape(ref.intervalDays)} dia(s)`:''}${ref.diagnosis?` · ${escape(ref.diagnosis)}`:''}<button type="button" class="inv-ghost" data-control-open-case="${escape(ref.caseId)}">Abrir chamado</button></li>`).join('')}</ul></article>`).join('')
            : '<p>Ainda não há categorias estruturadas anteriores para comparar.</p>'}
          <details><summary>Ocorrências recentes e tempos</summary><ul>${(recurrence.recentCases || []).map(entry=>`<li>Chamado ${escape(entry.id)} · ${escape(entry.state || 'A revisar')} · ${escape(date(entry.opened_at))}${entry.category?` · ${escape(entry.category)}`:''}${entry.maintenanceMinutes!=null?` · ${escape(elapsed(entry.maintenanceMinutes))} em manutenção`:''}${(entry.replacedParts || []).length?` · Peças substituídas: ${escape(entry.replacedParts.map(part=>part.name).join(', '))}`:''}<button type="button" class="inv-ghost" data-control-open-case="${escape(entry.id)}">Abrir chamado</button></li>`).join('')}</ul></details></section>`;
    const inventoryCase=c.source_module==='inventory';
    const conditionOptions=(inventoryCase?['Ativo','Reserva']:['Não se aplica','Ativo','Reserva'])
      .map(value=>`<option${value===(inventoryCase?'Ativo':'Não se aplica')?' selected':''}>${value}</option>`).join('');
    const resolutionForm=canEdit && !['Resolvido','Concluído','Cancelado'].includes(c.ticket_state)
      ? `<form data-control-case-resolution class="control-case-resolution-form"><h3>Registrar resolução</h3>
        <p>O registro não altera o status do Inventário nem realiza movimentação física. Para equipamentos do Inventário, confirme a condição final. A categoria é estruturada para permitir comparações; semelhança de texto não confirma reincidência.</p>
        <div class="control-case-form-grid"><label><span>Diagnóstico final *</span><textarea name="finalDiagnosis" minlength="3" maxlength="2000" required></textarea></label>
        <label><span>Solução aplicada *</span><textarea name="solution" minlength="3" maxlength="2000" required></textarea></label>
        <label><span>Testes realizados *</span><textarea name="tests" minlength="3" maxlength="2000" required></textarea></label>
        <label><span>Categoria técnica *</span><select name="failureCategory" required>${failureCategories.map(value=>`<option${value==='Outro'?' selected':''}>${escape(value)}</option>`).join('')}</select></label>
        <label><span>Condição final confirmada${inventoryCase?' *':''}</span><select name="finalCondition" required>${conditionOptions}</select></label>
        <label class="wide"><span>Observações</span><textarea name="observations" maxlength="2000"></textarea></label></div>
        <button type="submit" class="inv-primary">Salvar resolução</button></form>` : '';
    const closure=canEdit && data.tasksAvailable && c.ticket_state==='Resolvido'
      ? `<form data-control-case-close class="control-case-closure"><h3>Concluir chamado</h3>
        ${openTasks(data).length ? `<p>Há ${openTasks(data).length} pendência(s) aberta(s). Revise antes de concluir:</p><ul>${openTasks(data).map(t=>`<li>${escape(t.description)} · ${escape(t.task_state)}${t.due_at ? ' · Prazo '+escape(date(t.due_at)) : ''}</li>`).join('')}</ul><label class="control-case-consent"><input type="checkbox" name="keepOpen" required> Manter estas pendências abertas após concluir o chamado; nenhuma será marcada como concluída.</label>`
          : '<p>Não há pendências abertas neste chamado.</p>'}
        <label><span>Justificativa de encerramento *</span><textarea name="reason" minlength="3" maxlength="2000" required></textarea></label>
        <button type="submit" class="inv-primary">Concluir chamado</button></form>` : '';
    return `<div class="control-case-fields">
      ${field('ID do chamado',c.id)}${field('Equipamento',i.equipment || c.equipment)}
      ${field('TAG',i.tag || c.tag)}${field('Número de série',i.serial || c.serial)}
      ${field('Marca',i.brand)}${field('Modelo',i.model)}
      ${field('Setor',i.sector || c.sector)}${field('Local físico',data.location)}
      ${field('Módulo de origem',c.source_module)}${field('Status no Controle TI',i.status)}
      ${field('Estado do chamado',c.ticket_state || 'A revisar')}${field('Prioridade',duration.priorityLevel || c.priority)}
      ${field('Abertura',date(c.opened_at))}${field('Resolução',date(c.resolved_at))}
      ${field('Conclusão',date(c.closed_at))}${field('Tempo total',elapsed(duration.totalMinutes ?? (hours == null ? null : hours*60)))}
      ${field('Tempo até resolução',elapsed(duration.resolutionMinutes))}
      ${field('Tempo em verificação',elapsed(duration.verificationMinutes))}
      ${field('Tempo em manutenção',elapsed(duration.maintenanceMinutes))}
      ${field('Tempo aguardando',elapsed(duration.waitingMinutes))}
      ${field('Severidade por duração',duration.maintenanceSeverity)}
      ${field('Próxima ação',data.tasksAvailable
        ? next ? next.description+(next.due_at ? ' · prazo '+date(next.due_at) : '') : 'Nenhuma pendência aberta'
        : 'Indisponível até a migração 100')}
      <div class="control-case-field wide"><span>Descrição</span><b>${escape(description(i.notes) || 'Não registrada')}</b></div>
    </div>${resolutionRecord}${recurrencePanel}${resolutionForm}${priorityForm}${reopenForm}${c.requires_review ? '<p class="control-case-warning">Vínculo de origem legado requer revisão humana.</p>' : ''}${closure}`;
  }
  function diagnosis(data,canEdit) {
    const c=data.case || {}, versions=data.diagnostics || [], latest=versions[0] || {};
    const cards=versions.map(d=>`<details class="control-case-revision"${d===latest?' open':''}><summary>Revisão ${escape(d.revision)} · ${escape(date(d.created_at))}</summary><div class="control-case-fields">${fields.map(([key,label])=>field(label,d[key])).join('')}</div></details>`).join('');
    const form=canEdit && !['Concluído','Cancelado'].includes(c.ticket_state)
      ? `<form data-control-diagnostic-form><h3>Nova revisão</h3><p>Os registros anteriores permanecem intactos.</p><div class="control-case-form-grid">${fields.map(([key,label])=>`<label><span>${escape(label)}</span><textarea name="${key==='final_diagnosis'?'finalDiagnosis':key}" maxlength="2000" rows="2">${escape(latest[key] || '')}</textarea></label>`).join('')}</div><button type="submit" class="inv-primary">Salvar revisão</button></form>` : '';
    return `${versions.length ? cards : unavailable('Nenhum diagnóstico registrado','Descreva o sintoma e os testes na primeira revisão.')}${form}`;
  }
  function interventions(data,canEdit) {
    if (!data.interventionsAvailable) return unavailable('Intervenções indisponíveis',
      'O registro formal depende da migração 099; nenhum evento legado foi tratado como intervenção.');
    const rows=[...(data.interventions || [])].sort((a,b)=>
      String(a.occurred_at).localeCompare(String(b.occurred_at)) || String(a.id).localeCompare(String(b.id)));
    const timeline=rows.length ? `<ol class="control-case-timeline control-case-interventions">${rows.map(e=>`<li><b>${escape(e.intervention_type)}</b><time>${escape(date(e.occurred_at))}</time><small>ID ${escape(e.id)} · Estado no registro: ${escape(e.contextual_state || 'A revisar')}</small><p>${escape(e.description)}</p><p><strong>Resultado:</strong> ${escape(e.result)}</p>${e.technical_author ? `<small>Responsável técnico: ${escape(e.technical_author)}</small>` : ''}${e.reference_note ? `<small>Referência: ${escape(e.reference_note)}</small>` : ''}</li>`).join('')}</ol>`
      : unavailable('Nenhuma intervenção registrada','Registre as ações técnicas realizadas neste chamado.');
    const form=canEdit && !['Concluído','Cancelado'].includes(data.case?.ticket_state)
      ? `<form data-control-intervention-form><h3>Nova intervenção</h3><p>O estado atual será guardado como contexto; esta ação não o altera.</p><div class="control-case-form-grid"><label><span>Data e hora da ação *</span><input type="datetime-local" name="occurredAt" value="${localDateTime()}" required></label><label><span>Tipo *</span><select name="type" required>${interventionTypes.map(type=>`<option value="${escape(type)}">${escape(type)}</option>`).join('')}</select></label><label><span>Descrição *</span><textarea name="description" minlength="3" maxlength="2000" required rows="3"></textarea></label><label><span>Resultado *</span><textarea name="result" minlength="3" maxlength="2000" required rows="3"></textarea></label><label><span>Responsável técnico (opcional)</span><input name="technicalAuthor" maxlength="160"></label><label><span>OS, protocolo ou referência (opcional)</span><input name="referenceNote" maxlength="500"></label></div><button type="submit" class="inv-primary">Registrar intervenção</button></form>` : '';
    return `<h3>Intervenções · ${rows.length}</h3>${timeline}${form}`;
  }
  function movements(data) {
    const rows=data.movements || [];
    return rows.length ? `<ol class="control-case-timeline">${rows.map(e=>`<li><b>${escape(e.action)}</b><time>${escape(date(e.created_at))}</time><p>${escape(e.origin_location || e.previous_location || 'Origem não informada')} → ${escape(e.destination_location || e.new_location || 'Destino não informado')}</p>${e.reason ? `<small>${escape(e.reason)}</small>` : ''}</li>`).join('')}</ol>`
      : unavailable('Sem movimentação física vinculada','Mudanças de estado do chamado não são movimentações. Somente eventos físicos oficiais aparecem aqui.');
  }
  function pending(data,canEdit) {
    if (!data.tasksAvailable) return unavailable('Pendências indisponíveis',
      'O registro de tarefas e prazos depende da migração 100.');
    const rows=data.tasks || [];
    const cards=rows.length ? `<ol class="control-case-timeline control-case-pending">${rows.map(t=>{
      const overdue=['Pendente','Em andamento'].includes(t.task_state)
        && t.due_at && Date.parse(t.due_at)<Date.now();
      const edit=canEdit ? `<details><summary>Atualizar pendência</summary>
        <form data-control-task-update data-task-id="${escape(t.id)}" class="control-case-task-form">
          <input type="hidden" name="revision" value="${escape(t.revision)}">
          <div class="control-case-form-grid">
            <label><span>Descrição *</span><input name="description" minlength="3" maxlength="2000" value="${escape(t.description)}" required></label>
            <label><span>Prazo (opcional)</span><input type="datetime-local" name="dueAt" value="${escape(dateInput(t.due_at))}"></label>
            <label><span>Prioridade</span><select name="priority">${['Alta','Média','Baixa'].map(v=>`<option${v===t.priority?' selected':''}>${v}</option>`).join('')}</select></label>
            <label><span>Situação</span><select name="state">${['Pendente','Em andamento','Concluída','Cancelada'].map(v=>`<option${v===t.task_state?' selected':''}>${v}</option>`).join('')}</select></label>
            <label><span>Conclusão (obrigatória se concluída)</span><textarea name="completionNote" maxlength="2000">${escape(t.completion_note)}</textarea></label>
            <label><span>Observações</span><textarea name="notes" maxlength="2000">${escape(t.notes)}</textarea></label>
          </div><button type="submit" class="inv-primary">Salvar pendência</button>
        </form></details>` : '';
      return `<li class="${overdue?'control-case-task-overdue':''}"><b>${escape(t.description)}</b>
        <small>${escape(t.task_state)} · Prioridade ${escape(t.priority)} · Revisão ${escape(t.revision)}</small>
        <time>${t.due_at ? 'Prazo: '+escape(date(t.due_at)) : 'Sem prazo'}${overdue ? ' · Vencida' : ''}</time>
        ${t.notes ? `<p>Observações: ${escape(t.notes)}</p>` : ''}
        ${t.completion_note ? `<p>Conclusão: ${escape(t.completion_note)}</p>` : ''}${edit}</li>`;
    }).join('')}</ol>` : unavailable('Nenhuma pendência registrada',
      'Crie uma tarefa vinculada a este chamado, com prazo opcional.');
    const create=canEdit && !['Concluído','Cancelado'].includes(data.case?.ticket_state)
      ? `<form data-control-task-create class="control-case-task-form"><h3>Nova pendência</h3>
        <div class="control-case-form-grid"><label><span>Descrição *</span><input name="description" minlength="3" maxlength="2000" required></label>
        <label><span>Prazo (opcional)</span><input type="datetime-local" name="dueAt"></label>
        <label><span>Prioridade</span><select name="priority"><option>Média</option><option>Alta</option><option>Baixa</option></select></label>
        <label><span>Observações</span><textarea name="notes" maxlength="2000"></textarea></label></div>
        <button type="submit" class="inv-primary">Criar pendência</button></form>` : '';
    return `<h3>Pendências · ${rows.length}</h3>${cards}${create}`;
  }
  function components(data,canEdit) {
    if (!data.componentsAvailable) return unavailable('Componentes indisponíveis',
      'O histórico rastreável depende da migração 101.');
    const entries=data.components || [];
    const timeline=entries.length ? `<ol class="control-case-timeline control-case-components">${entries.map(c=>
      `<li><b>${escape(c.component_name)}</b><small>${escape([c.brand,c.model].filter(Boolean).join(' · ') || 'Componente')}</small>
        <small>${escape(c.inventory_item_id ? 'Inventário vinculado' : c.supply_unit_id ? 'Suprimentos vinculado' : 'Registro manual')}
          · TAG ${escape(c.tag || '—')} · Série ${escape(c.serial || '—')}</small>
        <ol class="control-case-component-events">${(c.events || []).map(e=>
          `<li><b>${escape(e.action)}</b><time>${escape(date(e.occurred_at))}</time>
            <p>${escape(e.result)}</p>${e.notes ? `<p>${escape(e.notes)}</p>` : ''}
            ${e.supplier ? `<small>Fornecedor: ${escape(e.supplier)} · ${escape(e.service_status)}${e.protocol ? ' · Protocolo '+escape(e.protocol) : ''}</small>` : ''}
            ${e.expected_return_at ? `<small>Previsão de retorno: ${escape(date(e.expected_return_at))}</small>` : ''}
            ${e.stock_destination ? `<small>Destino oficial de estoque: ${escape(e.stock_destination)}</small>` : ''}
            ${e.replacementUnit ? `<small>Nova unidade: ${escape([e.replacementUnit.name,e.replacementUnit.code,e.replacementUnit.serial_number].filter(Boolean).join(' · '))}</small>` : ''}
          </li>`).join('')}</ol>
      </li>`).join('')}</ol>` : unavailable('Nenhum componente registrado',
        'Registre uma peça inspecionada ou acompanhe um envio real a fornecedor.');
    const form=canEdit && !['Concluído','Cancelado'].includes(data.case?.ticket_state)
      ? `<form data-control-component-form><h3>Registrar componente ou ação externa</h3>
        <p>Escolha um item existente para usar a identidade cadastrada sem duplicá-la. Inspeções não alteram estoque; instalação, remoção e substituição explícitas usam a operação oficial de Suprimentos, sem criar Flux automaticamente.</p>
        <div class="control-case-form-grid">
          <label><span>Nome do componente (obrigatório para registro manual)</span><input name="name" maxlength="160"></label>
          <label><span>Marca</span><input name="brand" maxlength="160"></label>
          <label><span>Modelo</span><input name="model" maxlength="160"></label>
          <label><span>TAG</span><input name="tag" maxlength="100"></label>
          <label><span>Número de série</span><input name="serial" maxlength="160"></label>
          <label><span>Item do Inventário (opcional)</span><select name="inventoryItemId"><option value="">Registro manual</option>${(data.inventoryOptions || []).map(item=>`<option value="${escape(item.id)}">${escape([item.equipment,item.tag && 'TAG '+item.tag,item.serial && 'Série '+item.serial,item.status].filter(Boolean).join(' · '))}</option>`).join('')}</select></label>
          <label><span>Unidade rastreável de Suprimentos (opcional)</span><select name="supplyUnitId"><option value="">Não vincular</option>${(data.supplyOptions || []).map(item=>`<option value="${escape(item.id)}">${escape([item.name,item.code,item.serial_number,item.status].filter(Boolean).join(' · '))}</option>`).join('')}</select></label>
          <label><span>Ação *</span><select name="action" required>${['Inspecionado','Testado','Removido','Instalado','Substituído','Enviado ao fornecedor','Acompanhamento externo','Retornado do fornecedor'].map(v=>`<option>${escape(v)}</option>`).join('')}</select></label>
          <label><span>Nova unidade de Suprimentos (para substituição)</span><select name="replacementSupplyUnitId"><option value="">Selecione a unidade disponível</option>${(data.supplyOptions || []).filter(item=>item.status==='Em estoque').map(item=>`<option value="${escape(item.id)}">${escape([item.name,item.code,item.serial_number].filter(Boolean).join(' · '))}</option>`).join('')}</select></label>
          <label><span>Destino da unidade antiga (remoção/substituição)</span><select name="stockDestination"><option value="">Selecione quando aplicável</option><option>Em estoque</option><option>Reserva</option><option>Defeito</option><option>Inativo</option></select></label>
          <label><span>Data e hora *</span><input type="datetime-local" name="occurredAt" value="${localDateTime()}" required></label>
          <label><span>Resultado *</span><textarea name="result" minlength="3" maxlength="2000" required></textarea></label>
          <label><span>Observações</span><textarea name="notes" maxlength="2000"></textarea></label>
          <label><span>Fornecedor</span><input name="supplier" maxlength="200"></label>
          <label><span>Motivo</span><input name="reason" maxlength="1000"></label>
          <label><span>Protocolo</span><input name="protocol" maxlength="200"></label>
          <label><span>Previsão de retorno (envio externo)</span><input type="datetime-local" name="expectedReturnAt"></label>
          <label><span>Situação com fornecedor</span><select name="serviceStatus"><option value="">Não se aplica</option><option>Em análise</option><option>Aguardando orçamento</option><option>Em execução</option><option>Concluído</option></select></label>
        </div><button type="submit" class="inv-primary">Registrar no histórico</button></form>` : '';
    return `<h3>Componentes e manutenção externa · ${entries.length}</h3>${timeline}${form}`;
  }
  function history(data,legacyLogs) {
    const events=[...(data.transitions || []).map(t=>({at:t.created_at,title:'Estado: '+(t.next_state || 'A revisar'),text:t.reason,kind:t.source==='backfill'?'Registro inicial':'Transição'})),
      ...(data.resolutions || []).map(r=>({at:r.created_at,title:'Resolução técnica registrada',
        text:'Categoria: '+(r.failure_category || 'Não classificada')+' · Diagnóstico: '+r.final_diagnosis+' · Solução: '+r.solution+' · Testes: '+r.tests+
          ' · Condição: '+r.final_condition+(r.observations?' · '+r.observations:''),kind:'Resolução auditável'})),
      ...(data.priorityChanges || []).map(p=>({at:p.created_at,title:'Prioridade: '+p.next_priority,
        text:'Prioridade anterior: '+p.previous_priority,kind:'Classificação auditada'})),
      ...(data.diagnostics || []).map(d=>({at:d.created_at,title:'Diagnóstico · revisão '+d.revision,text:d.final_diagnosis || d.cause || d.symptom,kind:'Revisão imutável'})),
      ...(data.interventions || []).map(i=>({at:i.occurred_at,title:'Intervenção · '+i.intervention_type,
        text:i.description+' · Resultado: '+i.result,kind:'Ação técnica registrada'})),
      ...(data.taskEvents || []).map(e=>({at:e.created_at,
        title:'Pendência · '+e.action,
        text:(e.after_snapshot?.description || 'Tarefa')+' · '+(e.after_snapshot?.task_state || ''),
        kind:'Revisão auditada'}))]
      .sort((a,b)=>String(b.at).localeCompare(String(a.at)));
    const audited=events.length ? `<ol class="control-case-timeline">${events.map(e=>`<li><b>${escape(e.title)}</b><time>${escape(date(e.at))}</time><small>${escape(e.kind)}</small><p>${escape(e.text || 'Sem justificativa adicional')}</p></li>`).join('')}</ol>`
      : unavailable('Sem eventos auditados','Nenhuma transição ou revisão desta ocorrência foi encontrada.');
    const legacy=(legacyLogs || []).length ? `<section class="control-case-legacy"><h3>Notas anteriores do cadastro</h3><p>Estas notas pertencem ao equipamento e podem abranger outros episódios.</p><ul>${legacyLogs.map(e=>`<li>${escape(e.at)} · ${escape(e.text)}</li>`).join('')}</ul></section>` : '';
    return audited+legacy;
  }
  function panel(data,tab,canEdit,legacyLogs) {
    if (tab==='overview') return overview(data,canEdit);
    if (tab==='diagnosis') return diagnosis(data,canEdit);
    if (tab==='interventions') return interventions(data,canEdit);
    if (tab==='pending') return pending(data,canEdit);
    if (tab==='components') return components(data,canEdit);
    if (tab==='movements') return movements(data);
    if (tab==='history') return history(data,legacyLogs);
    return unavailable('Conteúdo indisponível','Revise a disponibilidade do chamado.');
  }
  function markup(data,tab='overview',canEdit=false,legacyLogs=[]) {
    const selected=tabs.some(([key])=>key===tab) ? tab : 'overview';
    return `<div class="control-case-detail"><header><div><small>Chamado ${escape(data.case?.id || '')}</small><h2>${escape(data.item?.equipment || data.case?.equipment || 'Chamado técnico')}</h2><p>${escape(data.case?.tag || 'Sem TAG')} · ${escape(data.case?.ticket_state || 'Estado a revisar')}</p></div></header>
      <nav class="control-case-tabs" aria-label="Detalhes do chamado">${tabs.map(([key,label])=>`<button type="button" data-control-case-tab="${key}" aria-selected="${selected===key}">${label}</button>`).join('')}</nav>
      <section class="control-case-panel" data-control-case-panel>${panel(data,selected,canEdit,legacyLogs)}</section></div>`;
  }
  return { markup,overview,diagnosis,interventions,pending,components,movements,history,tabs,elapsed,failureCategories };
});
