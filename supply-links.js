(() => {
  const api = window.AldeckotSupplies;
  if (!api) return;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const isControl = document.body.dataset.module === 'control';
  const isInventory = document.body.dataset.module === 'inventory';
  const isManagement = Boolean(document.body.dataset.managementPage);
  const sections = new Map();
  const unitLink = unit => `<a href="supplies.html?item=${encodeURIComponent(unit.supply_id)}&unit=${encodeURIComponent(unit.id)}">${escape(unit.code)}</a> <small>· ${escape(unit.supplies?.name || '')}</small>`;
  const renderEquipment = async (host, source, id) => {
    try {
      const data = await api.relatedFor(source, id);
      if (!host.isConnected) return;
      host.innerHTML = `<h3>Componentes / Suprimentos instalados</h3>${data.installed.length
        ? data.installed.map(unit => `<div class="supply-linked-row">${unitLink(unit)}<span>Instalado</span></div>`).join('')
        : '<p>Nenhum componente rastreável instalado.</p>'}
        ${data.maintenance.length ? `<p>Retirados para manutenção</p>${data.maintenance.map(unit => `<div class="supply-linked-row">${unitLink(unit)}<span>Em manutenção</span></div>`).join('')}` : ''}`;
    } catch (error) {
      if (host.isConnected) host.remove();
    }
  };
  const renderControl = async (host, id) => {
    try {
      const link = await api.maintenanceFor(id);
      if (!host.isConnected) return;
      if (!link) { host.remove(); return; }
      const unit = link.supply_units;
      host.innerHTML = `<h3>Manutenção de suprimento</h3><p>Unidade: ${unitLink(unit)} · ${escape(unit?.supplies?.category || '')}</p>
        <div class="supply-linked-row"><span>Status operacional</span><strong>${escape(unit?.status || '—')}</strong></div>
        <div class="supply-linked-row"><span>Status da ordem</span><strong>${escape(link.status)}</strong></div>
        <p>Defeito: ${escape(link.defect || '—')}</p>
        ${link.closed_at ? `<p>Destino: ${escape(link.destination || '—')} · encerrada em ${new Date(link.closed_at).toLocaleString('pt-BR')}</p>` :
          (window.AldeckotAuth?.isAdmin ? `<button type="button" data-supply-order="${escape(id)}">Atualizar manutenção e destino</button>` : '')}`;
      host.dataset.supplyControlId = id;
      sections.set(host, link);
    } catch (error) { if (host.isConnected) host.remove(); }
  };
  const scan = () => {
    if (isInventory || isControl) {
      document.querySelectorAll('.inv-modal[data-item-id]').forEach(modal => {
        if (!modal.dataset.itemId || modal.dataset.supplyEnhanced || !modal.querySelector('.inv-detail-grid')) return;
        modal.dataset.supplyEnhanced = 'true';
        const host = document.createElement('section');
        host.className = 'supply-linked-panel'; host.innerHTML = '<span class="aldeckot-inline-loading" role="status">Carregando suprimentos…</span>';
        modal.querySelector('.inv-log-head')?.before(host);
        if (isControl) renderControl(host, modal.dataset.itemId);
        else renderEquipment(host, 'inventory', modal.dataset.itemId);
      });
    }
    if (isManagement) {
      document.querySelectorAll('[data-supply-host-source="management"]').forEach(modal => {
        if (modal.dataset.supplyEnhanced) return;
        modal.dataset.supplyEnhanced = 'true';
        const host = document.createElement('section');
        host.className = 'supply-linked-panel'; host.innerHTML = '<span class="aldeckot-inline-loading" role="status">Carregando suprimentos…</span>';
        modal.append(host);
        renderEquipment(host, 'management', modal.dataset.supplyHostId);
      });
    }
  };
  let observer;
  const modal = document.createElement('div');
  modal.className = 'supply-linked-dialog-layer'; modal.hidden = true;
  modal.style.display = 'none'; document.body.append(modal);
  const close = () => { modal.hidden = true; modal.style.display = 'none'; modal.innerHTML = ''; };
  const controls = async id => {
    const link = [...sections.entries()].find(([host]) => host.isConnected && host.dataset.supplyControlId === id)?.[1]
      || await api.maintenanceFor(id);
    if (!link || link.closed_at) return;
    const equipment = await api.equipment();
    modal.hidden = false; modal.style.display = 'grid';
    modal.innerHTML = `<div class="supply-linked-dialog" role="dialog" aria-modal="true" aria-label="Atualizar manutenção"><h2>Manutenção — ${escape(link.supply_units?.code)}</h2>
      <p>Status operacional da unidade: ${escape(link.supply_units?.status)}. A ordem possui status independente.</p>
      <form data-supply-order-form><label>Status da ordem<select name="status"><option>Aberta</option><option>Em andamento</option><option>Aguardando peça</option><option>Concluída</option><option>Sem reparo</option></select></label>
      <label data-supply-destination-wrap hidden>Destino operacional<select name="destination"></select></label>
      <label data-supply-other-wrap hidden>Equipamento de destino<select name="target"><option value="">Selecione o equipamento</option>${equipment.map(row => `<option value="${row.source}:${row.id}">${escape(row.name)} · ${escape(row.tag || row.serial || row.model || '')} (${row.source === 'inventory' ? 'Inventário' : 'Gestão TI'})</option>`).join('')}</select></label>
      <label>Observações / resultado<textarea name="reason" placeholder="Descreva o atendimento"></textarea></label><p data-supply-error role="alert"></p>
      <footer><button type="button" data-supply-dialog-close>Cancelar</button><button type="submit">Salvar</button></footer></form></div>`;
    const status = modal.querySelector('[name=status]');
    status.value = link.status;
    const syncDestination = () => {
      const result = status.value;
      const wrap = modal.querySelector('[data-supply-destination-wrap]');
      const select = wrap.querySelector('select');
      wrap.hidden = !['Concluída','Sem reparo'].includes(result);
      select.innerHTML = result === 'Concluída'
        ? `<option value="">Escolha o destino</option>${link.origin_inventory_item_id || link.origin_management_record_id ? '<option value="reinstall">Reinstalar no equipamento de origem</option>' : ''}<option value="other">Instalar em outro equipamento</option><option value="stock">Voltar para estoque</option><option value="reserve">Reserva</option>`
        : '<option value="">Escolha o destino</option><option value="defect">Defeito</option><option value="inactive">Inativo</option>';
      modal.querySelector('[data-supply-other-wrap]').hidden = select.value !== 'other';
    };
    status.addEventListener('change', syncDestination);
    modal.querySelector('[name=destination]').addEventListener('change', event => {
      modal.querySelector('[data-supply-other-wrap]').hidden = event.target.value !== 'other';
    });
    syncDestination();
    modal.querySelector('[data-supply-order-form]').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.target; const button = form.querySelector('[type=submit]');
      const data = new FormData(form); const result = data.get('status');
      const reason = String(data.get('reason') || '').trim();
      const [source, targetId] = String(data.get('target') || '').split(':');
      button.disabled = true;
      try {
        if (['Concluída','Sem reparo'].includes(result)) {
          if (!reason || !data.get('destination')) throw new Error('Informe o resultado e o destino da unidade.');
          await api.completeMaintenance({ p_control_item_id: id, p_result: result, p_destination: data.get('destination'),
            p_inventory_item_id: source === 'inventory' ? targetId : null,
            p_management_record_id: source === 'management' ? targetId : null, p_reason: reason });
        } else {
          await api.setMaintenanceStatus({ p_control_item_id: id, p_status: result, p_notes: reason });
        }
        close();
        for (const host of sections.keys()) if (host.isConnected && host.dataset.supplyControlId === id) renderControl(host,id);
      } catch (error) {
        form.querySelector('[data-supply-error]').textContent = error.message || 'Falha ao atualizar manutenção.';
        button.disabled = false;
      }
    });
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-supply-order]');
    if (button) { controls(button.dataset.supplyOrder).catch(error => window.AldeckotMessage?.show?.(error.message || 'Não foi possível abrir a manutenção.')); return; }
    if (event.target === modal || event.target.closest('[data-supply-dialog-close]')) close();
  });
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.hidden) close(); });
  (async () => {
    try {
      await window.AldeckotAuthReady;
      await api.list();
      observer = new MutationObserver(scan);
      observer.observe(document.body, { childList: true, subtree: true });
      scan();
      await api.subscribe(() => {
        for (const host of sections.keys()) if (host.isConnected && host.dataset.supplyControlId) renderControl(host,host.dataset.supplyControlId);
        document.querySelectorAll('[data-supply-host-source="management"] .supply-linked-panel, .inv-modal[data-item-id] .supply-linked-panel').forEach(host => {
          const management = host.closest('[data-supply-host-source="management"]');
          const inventory = host.closest('.inv-modal[data-item-id]');
          if (management) renderEquipment(host,'management',management.dataset.supplyHostId);
          else if (inventory && isInventory) renderEquipment(host,'inventory',inventory.dataset.itemId);
        });
      });
    } catch { /* O módulo ainda não foi migrado; outros módulos permanecem intactos. */ }
  })();
})();
