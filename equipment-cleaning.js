(() => {
  const types = Object.freeze(['Completa', 'Preventiva', 'Regular', 'Não realizada']);
  const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const canonicalType = value => {
    const key = String(value || '').trim().toLowerCase();
    return types.find(type => type.toLowerCase() === key) || '';
  };
  const backend = () => window.AldeckotSupabase.cleaning;

  async function open({ module, item, onSaved }) {
    const dialog = document.createElement('dialog');
    dialog.className = 'equipment-cleaning-dialog';
    dialog.setAttribute('aria-labelledby', 'equipmentCleaningTitle');
    dialog.innerHTML = [
      '<form><h2 id="equipmentCleaningTitle">Registrar limpeza</h2>',
      '<p data-cleaning-equipment></p><label>Tipo de limpeza<select name="type" required>',
      '<option value="">Selecione</option>',
      ...types.map(type => '<option>' + type + '</option>'),
      '</select></label><fieldset hidden><legend>Periféricos que também receberam limpeza</legend></fieldset>',
      '<p data-cleaning-feedback role="status"></p>',
      '<footer><button type="button" data-cleaning-close>Cancelar</button>',
      '<button type="submit" disabled>Registrar limpeza</button></footer></form>'
    ].join('');
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.querySelector('[data-cleaning-close]').onclick = () => dialog.close();
    dialog.querySelector('[data-cleaning-equipment]').textContent =
      [item.equipment, item.tag || item.serial, module === 'management' ? item.terminal : item.location].filter(Boolean).join(' · ');
    const form = dialog.querySelector('form');
    const select = form.elements.type;
    const submit = form.querySelector('[type="submit"]');
    const feedback = form.querySelector('[data-cleaning-feedback]');
    const fieldset = form.querySelector('fieldset');
    const joint = module === 'management' && /^PDV\s+\d+$/i.test(item.terminal?.trim() || '');
    let ready = !joint;
    let saving = false;
    let request;
    const sync = () => {
      fieldset.disabled = saving || !select.value || select.value === 'Não realizada';
      submit.disabled = !ready || !select.value || saving;
    };
    select.addEventListener('change', sync);
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    dialog.showModal();
    if (joint) {
      feedback.textContent = 'Consultando os vínculos do PDV…';
      try {
        const peripherals = await backend().peripherals(item.id);
        if (!dialog.isConnected) return;
        for (const peripheral of peripherals) {
          const label = document.createElement('label');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.name = 'selected';
          checkbox.value = peripheral.id;
          checkbox.disabled = !peripheral.editable;
          const detail = [peripheral.equipment, peripheral.tag || peripheral.serial,
            peripheral.overdue ? 'limpeza vencida' : canonicalType(peripheral.cleaning_type),
            !peripheral.editable && 'somente leitura'].filter(Boolean).join(' · ');
          label.append(checkbox, document.createTextNode(detail));
          fieldset.append(label);
        }
        fieldset.hidden = !peripherals.length;
        feedback.textContent = peripherals.length ? 'Marque somente os periféricos que foram limpos.' : 'Nenhum periférico confirmado neste PDV.';
        ready = true;
      } catch (error) {
        feedback.textContent = error.message || 'Não foi possível verificar os vínculos deste PDV.';
      }
    }
    sync();
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submit.disabled) return;
      const fields = new FormData(form);
      const selected = fields.getAll('selected');
      const type = fields.get('type');
      const key = JSON.stringify([type, selected]);
      if (request?.key !== key) request = { key, id: crypto.randomUUID() };
      saving = true;
      select.disabled = true;
      const cancel = form.querySelector('[data-cleaning-close]');
      cancel.disabled = true;
      sync();
      let saved = false;
      try {
        await backend().record({ module, item, type, selected, id: request.id });
        saved = true;
        await onSaved?.();
        dialog.close();
      } catch (error) {
        if (saved) {
          dialog.close();
          window.AldeckotMessage?.show('Limpeza registrada. Atualize a página para conferir o resultado.');
          return;
        }
        feedback.textContent = error.message || 'Não foi possível registrar a limpeza.';
        saving = false;
        select.disabled = false;
        cancel.disabled = false;
        sync();
      }
    });
  }

  function groupAlerts(rows, scope) {
    const groups = new Map();
    for (const row of rows) {
      if (scope === 'inventory' && row.source_module !== 'inventory') continue;
      if (scope === 'management' && row.source_module !== 'management' && !row.position_id) continue;
      const key = row.pdv && row.position_id ? 'pdv:' + row.position_id : row.source_module + ':' + row.equipment_id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return [...groups].map(([key, entries]) => {
      entries.sort((a, b) => a.due_on.localeCompare(b.due_on) || a.equipment_id.localeCompare(b.equipment_id));
      const first = entries[0];
      const overdue = entries.some(row => row.overdue);
      const title = (overdue ? 'Limpeza vencida' : 'Limpeza a vencer') + (first.pdv ? ' · ' + first.pdv : ' · ' + first.equipment);
      const description = entries.map(row => [
        row.equipment,
        row.tag ? 'TAG ' + row.tag : row.serial ? 'Série ' + row.serial : '',
        'última limpeza ' + date.format(new Date(row.last_performed_at)),
        (row.overdue ? 'venceu em ' : 'vence em ') + row.due_on.split('-').reverse().join('/')
      ].filter(Boolean).join(' · ')).join(' | ');
      const module = scope === 'inventory' ? 'inventory' : first.position_id ? 'management' : first.source_module;
      const id = module === 'management' ? first.position_id : first.source_id;
      const targetUrl = module === 'management' ? 'management.html?item=' + encodeURIComponent(id)
        : 'inventory.html?table=' + encodeURIComponent(first.table_id) + '&item=' + encodeURIComponent(id);
      return { item: { id, module, tableId: first.table_id, equipment: title, tag: first.pdv ? '' : first.tag,
        serial: first.pdv ? '' : first.serial }, identifiers: first.pdv ? entries.length + ' equipamento(s)' : '',
        rule: 'cleaning', stateKey: 'cleaning:' + key, level: overdue ? 'Alta' : 'Média',
        weight: overdue ? 390 : 180, urgent: overdue, description, targetUrl, acknowledgeable: false,
        action: 'Conferir prazo de limpeza' };
    });
  }

  window.AldeckotEquipmentCleaning = Object.freeze({ types, canonicalType, open, groupAlerts });
})();
