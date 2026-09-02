(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const $ = selector => document.querySelector(selector);
  const MODULES = ['inventory', 'control', 'management', 'flux'];
  const MODULE = module => ({
    inventory: { label: 'Inventário', icon: '▣' },
    management: { label: 'Gestão TI', icon: '◉' },
    control: { label: 'Controle TI', icon: '⚙' },
    flux: { label: 'Flux', icon: '↔' }
  })[module] || { label: 'Módulo', icon: '◆' };
  const OPERATION = operation => ({ create: 'Inclusão', update: 'Atualização', delete: 'Exclusão', log: 'Histórico' })[operation] || 'Atualização';
  const dateTime = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Data não informada';
  const dateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? new Date(String(value) + 'T12:00').toLocaleDateString('pt-BR') : dateTime(value);
  const first = values => values.find(value => String(value || '').trim()) || '';
  const recentDate = values => values.filter(Boolean).sort((a, b) => String(b).localeCompare(String(a)))[0] || '';
  const meta = item => item && typeof item.metadata === 'object' && item.metadata ? item.metadata : {};
  const visibleNotes = value => String(value || '').replace(/^\[\[aldeckot:item-priority:(alta|media|estavel)\]\]\r?\n?/i, '');
  const service = () => window.AldeckotSupabase?.central;
  let searchTimer;
  let searchVersion = 0;
  let results = [];
  let modalState = null;

  function identity(item) {
    const tag = norm(item.tag);
    const serial = norm(item.serial);
    return tag ? 'tag:' + tag : 'serial:' + serial;
  }

  function sameEquipment(item, selected) {
    const tag = norm(selected.tag);
    const serial = norm(selected.serial);
    return Boolean(tag && norm(item.tag) === tag) || Boolean(serial && norm(item.serial) === serial);
  }

  function ordered(items) {
    return [...items].filter(Boolean).sort((a, b) => String(b.updated_at || b.occurredAt || b.created_at || '').localeCompare(String(a.updated_at || a.occurredAt || a.created_at || '')));
  }

  function uniqueResults(rows) {
    const groups = new Map();
    rows.forEach(row => {
      const key = identity(row);
      if (key === 'serial:') return;
      const current = groups.get(key);
      if (!current) groups.set(key, { ...row, modules: new Set([row.module]) });
      else {
        current.modules.add(row.module);
        if (String(row.updated_at).localeCompare(String(current.updated_at)) > 0) Object.assign(current, row);
      }
    });
    return [...groups.values()].map(row => ({ ...row, modules: [...row.modules] }));
  }

  function message(text, error) {
    const panel = $('[data-central-search-results]');
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = '<div class="central-search-message ' + (error ? 'error' : '') + '">' + esc(text) + '</div>';
  }

  function hideResults() {
    const panel = $('[data-central-search-results]');
    if (panel) {
      panel.hidden = true;
      panel.innerHTML = '';
    }
    results = [];
  }

  function renderResults(rows) {
    const panel = $('[data-central-search-results]');
    if (!panel) return;
    results = uniqueResults(rows);
    if (!results.length) return message('Nenhum equipamento encontrado para esta TAG ou nº de série.');
    panel.hidden = false;
    panel.innerHTML = results.map((row, index) => {
      const identifiers = [row.tag && 'TAG ' + row.tag, row.serial && 'Série ' + row.serial].filter(Boolean).join(' · ');
      const sources = row.modules.map(module => MODULE(module).label).join(' · ');
      return '<button class="central-search-result" type="button" data-central-result="' + index + '"><span><b>' + esc(row.equipment || 'Equipamento sem nome') + '</b><small>' + esc(identifiers) + ' · ' + esc(row.brand || 'Marca não informada') + '</small></span><em>' + esc(sources) + '</em></button>';
    }).join('');
    panel.querySelectorAll('[data-central-result]').forEach(button => button.addEventListener('click', () => openCentral(results[Number(button.dataset.centralResult)])));
  }

  async function search(value) {
    const request = ++searchVersion;
    const term = String(value || '').trim();
    if (!term) return hideResults();
    if (!service()) return message('A Central do Equipamento não está disponível nesta instalação.', true);
    message('Consultando TAG e nº de série…');
    try {
      const rows = await service().search(term);
      if (request === searchVersion) renderResults(rows);
    } catch (error) {
      if (request !== searchVersion) return;
      console.warn('Falha ao pesquisar na Central do Equipamento.', error);
      message('Não foi possível consultar a Central. Execute a migração 005 no Supabase e tente novamente.', true);
    }
  }

  async function matchesFor(selected) {
    const terms = [...new Set([selected.tag, selected.serial].filter(Boolean))];
    const rows = (await Promise.all(terms.map(term => service().search(term)))).flat().filter(row => sameEquipment(row, selected));
    const unique = new Map();
    [...rows, selected].forEach(row => unique.set(row.module + ':' + row.id, row));
    return ordered([...unique.values()]);
  }

  function records(matches, selected) {
    const unique = new Map();
    [...matches, selected].filter(row => row && row.id).forEach(row => unique.set(row.module + ':' + row.id, row));
    return ordered([...unique.values()]);
  }

  function getMeta(item, keys) {
    const source = meta(item);
    return first(keys.map(key => source[key]));
  }

  function summary(matches, selected) {
    const source = records(matches, selected);
    const read = extractor => first(source.map(extractor));
    return {
      equipment: read(row => row.equipment),
      tag: read(row => row.tag),
      serial: read(row => row.serial),
      brand: read(row => row.brand),
      model: read(row => row.model),
      company: read(row => getMeta(row, ['company', 'empresa', 'companyName', 'razaoSocial', 'razãoSocial'])),
      location: read(row => row.location || getMeta(row, ['sector', 'setor', 'location', 'local'])),
      responsible: read(row => row.responsible || getMeta(row, ['responsible', 'responsavel', 'responsável'])),
      status: read(row => row.status),
      cleaning: read(row => row.cleaning || getMeta(row, ['cleaning', 'cleaningType', 'tipoLimpeza', 'limpeza', 'situation', 'situacao'])),
      updatedAt: recentDate(source.map(row => row.updated_at))
    };
  }

  function statusTone(status) {
    const value = norm(status);
    if (/manutencao|defeito|descart/.test(value)) return 'danger';
    if (/reserva|aguard|atencao|verific/.test(value)) return 'warning';
    if (!value || /troca|substit/.test(value)) return 'neutral';
    return 'ok';
  }

  function when(event) {
    return event && (event.occurredAt || event.updated_at || event.created_at) || '';
  }

  function elapsed(value) {
    const instant = new Date(value).getTime();
    if (!Number.isFinite(instant)) return '';
    const days = Math.max(0, Math.floor((Date.now() - instant) / 86400000));
    return days === 0 ? 'hoje' : 'há ' + days + ' ' + (days === 1 ? 'dia' : 'dias');
  }

  function signals(current, matches, events, logs) {
    const list = [];
    const state = norm(current.status);
    const cleaning = norm(current.cleaning);
    const source = records(matches);
    const metadata = source.map(meta);
    const value = keys => first(metadata.map(row => first(keys.map(key => row[key]))));
    const maintenanceRecord = source.find(row => /manutencao/.test(norm(row.status)));
    const maintenance = ordered([...events, ...logs].filter(row => /manutenc|reparo|revis/.test(norm(row.description))));
    const cleaningLogs = ordered([...events, ...logs].filter(row => /limpez|higien/.test(norm(row.description))));
    const movements = ordered(events.filter(row => row.module === 'flux'));
    const priority = norm(value(['priority', 'prioridade', 'criticality', 'criticidade']));
    const pdv = value(['pdv', 'pdvName', 'pdvNome', 'pointOfSale', 'pontoDeVenda']);

    if (/manutencao/.test(state)) list.push({ tone: 'critical', icon: '⚙', title: 'Em manutenção', text: 'Status em manutenção ' + (elapsed(maintenanceRecord?.updated_at || current.updatedAt) || 'desde a última atualização') + '.' });
    if (/defeito|descart/.test(state)) list.push({ tone: 'critical', icon: '!', title: 'Situação crítica', text: 'Status atual: ' + current.status + '.' });
    if (/aguard|atencao|verific/.test(state)) list.push({ tone: 'attention', icon: '!', title: 'Requer atenção', text: 'Status atual: ' + current.status + '.' });
    if (/alta|high|urgent|critica|critico/.test(priority)) list.push({ tone: 'critical', icon: '↑', title: 'Prioridade alta', text: 'Indicada no cadastro do equipamento.' });
    if (/nao realizada|não realizada|pendente|sem limpeza/.test(cleaning)) list.push({ tone: 'attention', icon: '◌', title: 'Limpeza pendente', text: 'Sem limpeza concluída registrada ' + (elapsed(cleaningLogs[0]?.occurredAt || current.updatedAt) || 'nos dados disponíveis') + '.' });
    else if (cleaningLogs[0]) list.push({ tone: 'normal', icon: '✓', title: 'Última limpeza', text: 'Registro de limpeza ' + (elapsed(cleaningLogs[0].occurredAt) || dateTime(cleaningLogs[0].occurredAt)) + '.' });
    if (maintenance[0] && !/manutencao/.test(state)) list.push({ tone: 'normal', icon: '✓', title: 'Última manutenção', text: dateTime(maintenance[0].occurredAt) + ' - ' + (maintenance[0].description || 'Registro técnico atualizado.') });
    if (movements[0]) list.push({ tone: 'followup', icon: '↔', title: 'Última movimentação', text: dateTime(movements[0].occurredAt) + ' - ' + (movements[0].description || 'Movimentação registrada.') });
    if (/reserva/.test(state)) list.push({ tone: 'followup', icon: '◇', title: 'Em reserva', text: 'O equipamento está marcado como reserva.' });
    if (/matriz/.test(norm(current.location + ' ' + current.company))) list.push({ tone: 'normal', icon: '⌂', title: 'Na matriz', text: 'Localização atual identificada como matriz.' });
    if (pdv) list.push({ tone: 'followup', icon: '▤', title: 'Vinculado ao PDV', text: 'PDV ' + pdv + '.' });
    if (!list.length) list.push({ tone: 'normal', icon: '✓', title: 'Situação normal', text: 'Nenhuma condição que exija acompanhamento foi identificada nos dados disponíveis.' });
    return list.slice(0, 8);
  }

  function severity(list) {
    const weight = { critical: 4, attention: 3, followup: 2, normal: 1 };
    const best = [...list].sort((a, b) => weight[b.tone] - weight[a.tone])[0] || { tone: 'normal' };
    return { ...best, label: ({ critical: 'Crítico', attention: 'Atenção', followup: 'Acompanhamento', normal: 'Normal' })[best.tone] || 'Normal' };
  }

  function technicalCards(matches) {
    return matches.filter(row => ['inventory', 'management', 'control', 'flux'].includes(row.module)).map(row => {
      const data = meta(row);
      if (row.module === 'inventory') {
        const values = [row.model && 'Modelo ' + row.model, row.brand && 'Marca ' + row.brand, data.sector && 'Setor ' + data.sector, visibleNotes(row.notes) && 'Observações: ' + visibleNotes(row.notes)].filter(Boolean);
        return { module: row.module, icon: '▣', title: 'Dados cadastrais do Inventário', text: values.join(' · ') || 'Sem informações adicionais cadastradas.' };
      }
      if (row.module === 'control') {
        const values = [row.status && 'Status: ' + row.status, row.cleaning && 'Limpeza: ' + row.cleaning, data.entryDate && 'Entrada: ' + dateOnly(data.entryDate), data.exitDate && 'Saída: ' + dateOnly(data.exitDate), visibleNotes(row.notes) && 'Observações: ' + visibleNotes(row.notes)].filter(Boolean);
        return { module: row.module, icon: '⚙', title: 'Manutenção e limpeza', text: values.join(' · ') || 'Sem informações técnicas adicionais cadastradas.' };
      }
      if (row.module === 'management') {
        const monitoring = data.monitoring || {};
        const values = [data.ip && 'IP ' + data.ip, data.gateway && 'Gateway ' + data.gateway, data.subnetMask && 'Máscara ' + data.subnetMask, data.operatingSystem, data.sector && 'Setor ' + data.sector, monitoring.ping && 'Ping ' + monitoring.ping + ' ms'].filter(Boolean);
        return { module: row.module, icon: '◉', title: 'Monitoramento da Gestão TI', text: values.join(' · ') || 'Sem telemetria registrada para este equipamento.' };
      }
      if (row.module === 'flux') {
        const values = [data.movement && 'Movimentação: ' + data.movement, data.senderCompany && 'Remetente: ' + data.senderCompany, data.destinationCompany && 'Destino: ' + data.destinationCompany, data.shippingType && 'Envio: ' + data.shippingType, data.reason && 'Motivo: ' + data.reason, data.sendDate && 'Data de envio: ' + dateOnly(data.sendDate), data.receivedDate && 'Recebimento: ' + dateOnly(data.receivedDate)].filter(Boolean);
        return { module: row.module, icon: '↔', title: 'Envio e recebimento', text: values.join(' · ') || 'Sem informações de movimentação adicionais.' };
      }
      return null;
    }).filter(Boolean);
  }

  function insightMarkup(list) {
    const labels = { critical: 'Crítico', attention: 'Atenção', followup: 'Acompanhamento', normal: 'Normal' };
    return list.map(item => '<article class="central-insight" data-tone="' + esc(item.tone) + '"><span class="central-insight-icon">' + esc(item.icon) + '</span><div><b>' + esc(item.title) + '</b><p>' + esc(item.text) + '</p></div><span class="central-severity-badge" data-tone="' + esc(item.tone) + '">' + esc(labels[item.tone]) + '</span></article>').join('');
  }

  function movementMarkup(events) {
    return MODULES.map(module => {
      const recent = ordered(events.filter(event => event.module === module)).slice(0, 3);
      const content = recent.length ? recent.map(event => '<article class="central-movement"><time>' + esc(dateTime(when(event))) + '</time><b>' + esc(OPERATION(event.operation)) + '</b><p>' + esc(event.description || 'Registro atualizado.') + '</p></article>').join('') : '<p class="central-movement-empty">Sem movimentações registradas.</p>';
      return '<section class="central-movement-module" data-module="' + esc(module) + '"><header><span>' + esc(MODULE(module).icon) + '</span><h4>' + esc(MODULE(module).label) + '</h4></header><div>' + content + '</div></section>';
    }).join('');
  }

  function technicalMarkup(cards) {
    const summaries = cards.map(card => '<article class="central-tech-card" data-module="' + esc(card.module) + '"><h4><i>' + esc(card.icon) + '</i>' + esc(card.title) + '</h4><p>' + esc(card.text) + '</p></article>').join('');
    return summaries || '<div class="central-technical-empty">Nenhuma ficha técnica disponível nos módulos integrados.</div>';
  }

  function audit(events, logs) {
    const recent = new Map();
    ordered([...events, ...logs]).forEach(event => {
      if (MODULES.includes(event.module) && !recent.has(event.module)) recent.set(event.module, event);
    });
    return MODULES.map(module => recent.get(module)).filter(Boolean);
  }

  function auditMarkup(entries) {
    if (!entries.length) return '';
    return '<section class="central-panel central-audit"><header class="central-panel-header"><div><h3>Auditoria resumida</h3><p>Último registro disponível em cada módulo</p></div></header><div class="central-audit-list">' + entries.map(event => '<article class="central-audit-item" data-module="' + esc(event.module) + '"><span>' + esc(MODULE(event.module).icon) + '</span><div><b>' + esc(MODULE(event.module).label) + '</b><p>' + esc(event.description || 'Registro atualizado.') + '</p></div><time>' + esc(dateTime(when(event))) + '</time></article>').join('') + '</div></section>';
  }

  function operationalData(current, matches) {
    const source = records(matches);
    const values = keys => first(source.map(row => getMeta(row, keys)));
    const control = source.find(row => row.module === 'control');
    const flux = source.find(row => row.module === 'flux');
    const tables = [...new Set(source.map(row => row.table_name).filter(Boolean))];
    const sourceModules = [...new Set(source.map(row => row.module))];
    const notes = first(source.map(row => visibleNotes(row.notes)));
    const links = [current.company, values(['pdv', 'pdvName', 'pdvNome', 'pointOfSale', 'pontoDeVenda']) && 'PDV ' + values(['pdv', 'pdvName', 'pdvNome', 'pointOfSale', 'pontoDeVenda'])].filter(Boolean);
    const dates = [
      control && getMeta(control, ['entryDate']) && 'Entrada: ' + dateOnly(getMeta(control, ['entryDate'])),
      control && getMeta(control, ['exitDate']) && 'Saída: ' + dateOnly(getMeta(control, ['exitDate'])),
      flux && getMeta(flux, ['sendDate']) && 'Envio: ' + dateOnly(getMeta(flux, ['sendDate'])),
      flux && getMeta(flux, ['receivedDate']) && 'Recebimento: ' + dateOnly(getMeta(flux, ['receivedDate']))
    ].filter(Boolean);
    const movement = flux && [getMeta(flux, ['movement']) && 'Movimentação: ' + getMeta(flux, ['movement']), getMeta(flux, ['senderCompany']) && 'Remetente: ' + getMeta(flux, ['senderCompany']), getMeta(flux, ['destinationCompany']) && 'Destino: ' + getMeta(flux, ['destinationCompany'])].filter(Boolean).join(' · ');
    return [
      { label: 'Módulos vinculados', value: sourceModules.map(module => MODULE(module).label).join(' · ') || 'Nenhum módulo vinculado' },
      { label: 'Tabelas relacionadas', value: tables.join(' · ') || 'Nenhuma tabela identificada' },
      { label: 'Vínculos operacionais', value: links.join(' · ') || 'Nenhum vínculo adicional registrado' },
      { label: 'Última movimentação', value: movement || 'Nenhuma movimentação registrada no Flux' },
      { label: 'Datas de ciclo', value: dates.join(' · ') || 'Sem datas de entrada ou saída registradas' },
      { label: 'Cadastro inicial', value: source.length ? dateTime(source.map(row => row.created_at).filter(Boolean).sort()[0]) : 'Data não informada' },
      { label: 'Observações vigentes', value: notes || 'Sem observações atuais registradas' }
    ];
  }

  function operationalMarkup(items) {
    return '<section class="central-panel central-operational"><header class="central-panel-header"><div><h3>Dossiê operacional</h3><p>Vínculos, contexto e dados complementares do equipamento</p></div></header><div class="central-operational-grid">' + items.map(item => '<article class="central-operational-card"><i>' + esc(item.label) + '</i><b>' + esc(item.value) + '</b></article>').join('') + '</div></section>';
  }

  function safeName(value) {
    return String(value || 'equipamento').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'equipamento';
  }

  function pdfText(value, fallback) {
    const text = String(value || fallback || 'Não informado').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
    return text || fallback || 'Não informado';
  }

  function exportPdf() {
    const data = modalState?.data;
    const JsPdf = window.jspdf?.jsPDF;
    if (!data) return;
    if (!JsPdf) return window.alert('O gerador de PDF não foi carregado. Verifique sua conexão e tente novamente.');
    const doc = new JsPdf({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();
    const margin = 14;
    const usable = width - margin * 2;
    let y = margin;
    const header = () => {
      doc.setFillColor(9, 27, 50); doc.rect(0, 0, width, 22, 'F');
      doc.setTextColor(82, 220, 245); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('ALDECKOT', margin, 9);
      doc.setTextColor(242, 248, 255); doc.setFontSize(10); doc.text('Central do Equipamento', margin, 15);
      doc.setTextColor(176, 202, 226); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      doc.text('Gerado em ' + new Date().toLocaleString('pt-BR'), width - margin, 15, { align: 'right' }); y = 31;
    };
    const space = needed => {
      if (y + needed <= height - 16) return;
      doc.addPage(); header();
    };
    const section = title => {
      space(13); doc.setDrawColor(79, 171, 226); doc.setLineWidth(.45); doc.line(margin, y, margin + usable, y); y += 5;
      doc.setTextColor(20, 59, 92); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(pdfText(title), margin, y); y += 6;
    };
    const paragraph = (text, indent, color) => {
      const lines = doc.splitTextToSize(pdfText(text), usable - (indent || 0));
      space(lines.length * 4.4 + 3); doc.setTextColor(...(color || [48, 77, 108])); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.7);
      doc.text(lines, margin + (indent || 0), y); y += lines.length * 4.4 + 3;
    };
    const pairs = values => {
      const cell = (usable - 6) / 2;
      for (let index = 0; index < values.length; index += 2) {
        const prepared = values.slice(index, index + 2).map(pair => ({ label: pdfText(pair[0]), lines: doc.splitTextToSize(pdfText(pair[1]), cell - 8) }));
        const box = Math.max(...prepared.map(entry => 12 + entry.lines.length * 4)) + 2;
        space(box);
        prepared.forEach((entry, column) => {
          const x = margin + column * (cell + 6);
          doc.setFillColor(239, 247, 252); doc.setDrawColor(183, 212, 235); doc.roundedRect(x, y, cell, box - 2, 2, 2, 'FD');
          doc.setTextColor(65, 105, 139); doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.text(entry.label.toUpperCase(), x + 4, y + 5);
          doc.setTextColor(19, 53, 83); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.7); doc.text(entry.lines, x + 4, y + 10);
        });
        y += box + 3;
      }
    };
    const list = entries => entries.forEach(entry => {
      const lines = doc.splitTextToSize(pdfText(entry), usable - 5);
      space(lines.length * 4.4 + 3); doc.setTextColor(28, 80, 122); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('-', margin, y);
      doc.setTextColor(48, 77, 108); doc.setFont('helvetica', 'normal'); doc.text(lines, margin + 5, y); y += lines.length * 4.4 + 3;
    });

    header();
    doc.setTextColor(14, 45, 74); doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text(pdfText(data.summary.equipment || data.selected.equipment, 'Equipamento'), margin, y); y += 6;
    doc.setTextColor(77, 111, 143); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.7);
    doc.text(pdfText([data.summary.tag && 'TAG ' + data.summary.tag, data.summary.serial && 'Nº de série ' + data.summary.serial].filter(Boolean).join(' - '), 'Identificador não informado'), margin, y); y += 9;
    section('Resumo atual');
    pairs([
      ['TAG', data.summary.tag], ['Número de série', data.summary.serial], ['Marca', data.summary.brand], ['Modelo', data.summary.model],
      ['Empresa', data.summary.company], ['Localização atual', data.summary.location], ['Responsável', data.summary.responsible], ['Status', data.summary.status],
      ['Situação da limpeza', data.summary.cleaning], ['Última atualização', dateTime(data.summary.updatedAt)]
    ]);
    section('Central de Informações Inteligente');
    const severityLabels = { critical: 'Crítico', attention: 'Atenção', followup: 'Acompanhamento', normal: 'Normal' };
    list(data.signals.map(item => item.title + ': ' + item.text + ' (' + (severityLabels[item.tone] || 'Normal') + ').'));
    section('Últimas movimentações por módulo');
    MODULES.forEach(module => {
      const events = ordered(data.events.filter(event => event.module === module)).slice(0, 3);
      space(7); doc.setTextColor(21, 70, 108); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.4); doc.text(MODULE(module).label, margin, y); y += 4;
      if (events.length) list(events.map(event => dateTime(when(event)) + ' - ' + OPERATION(event.operation) + ': ' + (event.description || 'Registro atualizado.')));
      else paragraph('Sem movimentações registradas.', 0, [91, 119, 146]);
    });
    section('Dossiê operacional');
    list(data.operational.map(item => item.label + ': ' + item.value));
    section('Histórico técnico');
    const cards = technicalCards(data.matches);
    if (cards.length) list(cards.map(card => card.title + ': ' + card.text));
    if (!cards.length) paragraph('Nenhuma ficha técnica disponível nos módulos Inventário e Controle TI.', 0, [91, 119, 146]);
    if (data.audit.length) {
      section('Auditoria resumida');
      list(data.audit.map(event => MODULE(event.module).label + ' - ' + dateTime(when(event)) + ': ' + (event.description || 'Registro atualizado.')));
    }
    const total = doc.getNumberOfPages();
    for (let page = 1; page <= total; page += 1) {
      doc.setPage(page); doc.setDrawColor(190, 212, 231); doc.line(margin, height - 10, width - margin, height - 10);
      doc.setTextColor(100, 127, 153); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2); doc.text('ALDECKOT - prontuário do equipamento', margin, height - 5);
      doc.text('Página ' + page + ' de ' + total, width - margin, height - 5, { align: 'right' });
    }
    doc.save('central-do-equipamento-' + safeName(data.summary.tag || data.summary.serial || data.summary.equipment) + '.pdf');
  }

  function shell(selected) {
    const identifiers = [selected.tag && 'TAG ' + selected.tag, selected.serial && 'Série ' + selected.serial].filter(Boolean).join(' · ');
    return '<div class="central-equipment-dialog" role="dialog" aria-modal="true" aria-labelledby="central-equipment-title"><header class="central-head"><div><p class="central-eyebrow"><i>◈</i>Central do Equipamento</p><h2 id="central-equipment-title">' + esc(selected.equipment || 'Equipamento') + '</h2><p class="central-identity"><span>' + esc(identifiers || 'Identificador não informado') + '</span><span>' + esc(selected.brand || 'Marca não informada') + '</span></p></div><div class="central-head-actions"><button class="central-export-pdf" type="button" data-central-export-pdf aria-label="Exportar prontuário em PDF">⇩ Exportar PDF</button><button class="central-close" type="button" data-central-close aria-label="Fechar Central do Equipamento">×</button></div></header><div class="central-loading"><i></i><span>Carregando informações integradas…</span></div></div>';
  }

  function closeCentral() {
    if (!modalState) return;
    modalState.unsubscribe?.(); window.clearInterval(modalState.poll); window.clearTimeout(modalState.refreshTimer);
    document.removeEventListener('keydown', modalState.escapeHandler); modalState.node.remove(); modalState = null;
  }

  function cardsMarkup(current) {
    const items = [
      ['TAG', current.tag || 'Não informada'], ['Nº de série', current.serial || 'Não informado'], ['Marca', current.brand || 'Não informada'],
      ['Modelo', current.model || 'Não informado'], ['Empresa', current.company || 'Não informada'], ['Localização atual', current.location || 'Não informada'],
      ['Responsável', current.responsible || 'Não informado'], ['Status', current.status || 'Não informado', 'status ' + statusTone(current.status), statusTone(current.status)],
      ['Situação da limpeza', current.cleaning || 'Não informada'], ['Última atualização', dateTime(current.updatedAt)]
    ];
    return items.map(item => '<article class="central-summary-card ' + (item[2] || '') + '" data-tone="' + esc(item[3] || '') + '"><i>' + esc(item[0]) + '</i><b>' + esc(item[1]) + '</b></article>').join('');
  }

  async function render(selected, node) {
    const dialog = node.querySelector('.central-equipment-dialog');
    if (!dialog) return;
    try {
      const matches = await matchesFor(selected);
      const fetched = await Promise.all([service().timeline(selected, matches), service().technicalHistory(matches)]);
      if (!node.isConnected) return;
      const current = summary(matches, selected);
      const logs = fetched[1];
      const events = ordered(fetched[0].length ? fetched[0] : logs.map(log => ({ ...log, actor: 'Equipe ALDECKOT' })));
      const information = signals(current, matches, events, logs);
      const criticality = severity(information);
      const entries = audit(events, logs);
      const operational = operationalData(current, matches);
      const sources = [...new Set(matches.map(row => row.module))];
      const identifiers = [current.tag && 'TAG ' + current.tag, current.serial && 'Série ' + current.serial].filter(Boolean).join(' · ');
      if (modalState?.node === node) modalState.data = { selected, matches, summary: current, events, technicalLogs: logs, signals: information, audit: entries, operational };
      dialog.innerHTML = '<header class="central-head"><div><p class="central-eyebrow"><i>◈</i>Central do Equipamento</p><h2 id="central-equipment-title">' + esc(current.equipment || selected.equipment || 'Equipamento') + '</h2><p class="central-identity"><span>' + esc(identifiers || 'Identificador não informado') + '</span><span>' + esc(current.brand || 'Marca não informada') + '</span></p><div class="central-module-list">' + sources.map(module => '<span class="central-module-chip" data-module="' + esc(module) + '">' + esc(MODULE(module).icon) + ' ' + esc(MODULE(module).label) + '</span>').join('') + '</div></div><div class="central-head-actions"><span class="central-severity-badge central-overall-badge" data-tone="' + esc(criticality.tone) + '">' + esc(criticality.label) + '</span><button class="central-export-pdf" type="button" data-central-export-pdf>⇩ Exportar PDF</button><button class="central-close" type="button" data-central-close aria-label="Fechar Central do Equipamento">×</button></div></header><section class="central-summary" aria-label="Resumo atual do equipamento">' + cardsMarkup(current) + '</section><section class="central-panel central-information"><header class="central-panel-header"><div><h3>Central de Informações Inteligente</h3><p>Condições calculadas somente com os registros disponíveis do equipamento</p></div><span class="central-live"><i></i>Ao vivo</span></header><div class="central-insights">' + insightMarkup(information) + '</div></section><section class="central-content"><section class="central-panel"><header class="central-panel-header"><div><h3>Últimas movimentações por módulo</h3><p>Até três registros recentes em cada módulo integrado</p></div></header><div class="central-movements">' + movementMarkup(events) + '</div></section><aside class="central-panel"><header class="central-panel-header"><div><h3>Histórico técnico</h3><p>Ficha consolidada de cadastro, manutenção e limpeza</p></div></header><div class="central-technical">' + technicalMarkup(technicalCards(matches)) + '</div></aside></section>' + operationalMarkup(operational) + auditMarkup(entries);
      dialog.querySelector('[data-central-close]')?.focus();
    } catch (error) {
      console.warn('Falha ao carregar a Central do Equipamento.', error);
      dialog.innerHTML = '<header class="central-head"><div><p class="central-eyebrow"><i>◈</i>Central do Equipamento</p><h2 id="central-equipment-title">' + esc(selected.equipment || 'Equipamento') + '</h2></div><button class="central-close" type="button" data-central-close aria-label="Fechar Central do Equipamento">×</button></header><div class="central-error">Não foi possível carregar os dados integrados. Confirme que a migração 005 foi executada no Supabase.</div>';
    }
  }

  async function openCentral(selected) {
    if (!selected || !service()) return;
    hideResults(); closeCentral();
    const node = document.createElement('div');
    node.className = 'central-equipment-modal'; node.innerHTML = shell(selected); document.body.appendChild(node);
    const escapeHandler = event => { if (event.key === 'Escape') closeCentral(); };
    modalState = { node, unsubscribe: null, escapeHandler, refreshTimer: null, data: null };
    node.addEventListener('click', event => {
      if (event.target === node || event.target.closest('[data-central-close]')) closeCentral();
      if (event.target.closest('[data-central-export-pdf]')) exportPdf();
    });
    document.addEventListener('keydown', escapeHandler);
    await render(selected, node);
    if (!modalState || modalState.node !== node) return;
    const refresh = () => {
      window.clearTimeout(modalState?.refreshTimer);
      modalState.refreshTimer = window.setTimeout(() => render(selected, node), 260);
    };
    try { modalState.unsubscribe = await service().subscribe(refresh); }
    catch (error) { console.warn('Atualização em tempo real indisponível para a Central.', error); }
  }

  function setupSearch() {
    const input = $('[data-central-search-input]');
    const panel = $('[data-central-search-results]');
    if (!input || !panel) return;
    input.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => search(input.value), 230);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') return hideResults();
      if (event.key === 'Enter' && results.length === 1) {
        event.preventDefault(); openCentral(results[0]);
      }
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('[data-central-search]')) hideResults();
    });
  }

  window.openEquipmentCentral = openCentral;
  setupSearch();
})();
