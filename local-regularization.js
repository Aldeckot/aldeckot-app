(() => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const peripheralTag = tag => /^(?:IMPR|EAN|GVT|PP|BAL|AJMON|MON|TEC)[0-9]+$/i.test(String(tag || '').trim());
  let active = null;

  function close() {
    active?.remove();
    active = null;
  }

  async function open({ item = null, location = '', sector = '', status = 'Ativo', reason = '', onSaved } = {}) {
    close();
    const api = window.AldeckotSupabase?.inventory;
    if (!api?.previewLocalRegularization || !api?.confirmLocalRegularization)
      throw new Error('Conferência de local indisponível. Recarregue a página.');
    let items = [];
    if (!item) {
      const data = await api.load();
      items = data.tables.flatMap(table => table.items)
        .filter(entry => peripheralTag(entry.tag))
        .sort((a, b) => String(a.tag || '').localeCompare(String(b.tag || ''), 'pt-BR'));
    }
    const host = document.createElement('div');
    host.className = 'local-regularization-overlay';
    host.innerHTML = `<section class="local-regularization-dialog" role="dialog" aria-modal="true" aria-labelledby="localRegularizationTitle">
      <header><div><h2 id="localRegularizationTitle">Regularização de Local</h2><p>Revise o equipamento, o destino e os vínculos antes de confirmar.</p></div><button type="button" data-local-close aria-label="Fechar">×</button></header>
      <form data-local-form>
        <label>Equipamento
          ${item ? `<strong>${escape(item.equipment)} · ${escape(item.tag || item.serial || 'Sem identificação')}</strong><input name="itemId" type="hidden" value="${escape(item.id)}">`
            : `<select name="itemId" required><option value="">Selecione o periférico</option>${items.map(entry => `<option value="${escape(entry.id)}">${escape(entry.tag || entry.serial)} · ${escape(entry.equipment)} · ${escape(entry.location || 'Sem local')}</option>`).join('')}</select>`}
        </label>
        <div class="local-regularization-grid"><label>Local de destino<input name="location" required value="${escape(location)}" placeholder="PDV 10"></label>
          <label>Setor<input name="sector" required value="${escape(sector)}"></label>
          <label>Status final<select name="status">${['Ativo','Reserva','Manutenção','Defeito'].map(value => `<option ${status === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
          <label>Natureza<select name="intent"><option value="correction">Correção cadastral</option><option value="movement">Movimentação física</option><option value="return">Regularização após retorno</option></select></label></div>
        <label>Motivo<input name="reason" required minlength="5" maxlength="500" value="${escape(reason)}" placeholder="Descreva a conferência realizada"></label>
        <div class="local-regularization-preview" data-local-preview aria-live="polite">Escolha os dados e clique em Conferir.</div>
        <div class="local-regularization-replacement" data-local-replacement hidden>
          <h3>Substituir o ocupante do slot</h3>
          <p data-local-outgoing></p>
          <div class="local-regularization-grid">
            <label>Status do retirado<select name="removedStatus"><option>Reserva</option><option>Manutenção</option><option>Defeito</option><option>Inativo</option></select></label>
            <label>Local do retirado<input name="removedLocation" placeholder="Informe um local fora do PDV"></label>
            <label>Setor do retirado<input name="removedSector" value="${escape(sector)}"></label>
          </div>
          <button type="button" data-local-replacement-review>Conferir substituição</button>
        </div>
        <footer><button type="button" data-local-close>Cancelar</button><button type="button" data-local-review>Conferir</button><button type="submit" data-local-confirm disabled>Confirmar alteração</button></footer>
      </form></section>`;
    document.body.append(host);
    active = host;
    const form = host.querySelector('[data-local-form]');
    const previewNode = host.querySelector('[data-local-preview]');
    const confirmButton = host.querySelector('[data-local-confirm]');
    const reviewButton = host.querySelector('[data-local-review]');
    const replacementPanel = host.querySelector('[data-local-replacement]');
    const replacementButton = host.querySelector('[data-local-replacement-review]');
    let reviewed = null;
    let mode = 'regularization';
    let outgoingId = null;
    let requestId = null;
    let revision = 0;
    const values = () => Object.fromEntries(new FormData(form));
    const describe = data => {
      const from = data.item || {};
      const to = data.target || {};
      const inventoryCount = (data.occupants || []).length;
      const managementCount = (data.managementOccupants || []).length;
      return `<strong>${escape(from.equipment)} · ${escape(from.tag || from.serial || 'Sem identificação')}</strong>
        <p>${escape(from.location || 'Sem local')} / ${escape(from.status)} → ${escape(to.location)} / ${escape(to.status)}</p>
        <p>Inventário e Gestão TI serão conferidos na mesma operação.</p>
        ${inventoryCount || managementCount ? `<p class="local-regularization-warning">O slot está ocupado: ${inventoryCount} registro(s) no Inventário e ${managementCount} vínculo(s) na Gestão TI. ${escape(data.reason || '')}</p>` : ''}
        ${data.blocked && !inventoryCount && !managementCount ? `<p class="local-regularization-warning">${escape(data.reason || 'Operação bloqueada.')}</p>` : ''}`;
    };
    const describeReplacement = data => `<strong>${escape(data.outgoing?.tag || data.outgoing?.serial)} → ${escape(data.incoming?.tag || data.incoming?.serial)}</strong>
      <p>${escape(data.outgoing?.equipment)} sai de ${escape(data.outgoing?.location)} para ${escape(data.removedFinal?.location)} como ${escape(data.removedFinal?.status)}.</p>
      <p>${escape(data.incoming?.equipment)} sai de ${escape(data.incoming?.location || 'sem local')} e ocupa ${escape(data.target?.location)} como Ativo.</p>
      <p>Inventário, Gestão TI e eventual acompanhamento no Controle TI serão atualizados em uma transação.</p>
      ${data.blocked ? `<p class="local-regularization-warning">${escape(data.reason)}</p>` : ''}`;
    host.addEventListener('click', event => {
      if (event.target === host || event.target.closest('[data-local-close]')) close();
    });
    form.addEventListener('input', event => {
      revision += 1;
      reviewed = null; requestId = null; mode = 'regularization'; confirmButton.disabled = true;
      if (['itemId', 'location', 'sector', 'status', 'intent'].includes(event.target.name)) {
        outgoingId = null;
        replacementPanel.hidden = true;
      }
      previewNode.textContent = 'Dados alterados. Confira novamente antes de confirmar.';
    });
    reviewButton.addEventListener('click', async () => {
      if (!form.reportValidity()) return;
      const draft = values();
      const reviewedRevision = revision;
      reviewButton.disabled = true;
      previewNode.textContent = 'Conferindo posição e equipamento…';
      try {
        const result = await api.previewLocalRegularization(draft.itemId, draft);
        if (reviewedRevision !== revision) return;
        reviewed = result;
        mode = 'regularization';
        requestId = crypto.randomUUID();
        previewNode.innerHTML = describe(reviewed);
        confirmButton.disabled = Boolean(reviewed.blocked);
        const inventoryOccupants = reviewed.occupants || [];
        const managementOccupants = reviewed.managementOccupants || [];
        const outgoing = inventoryOccupants.length === 1 && managementOccupants.length === 1
          && managementOccupants[0]?.sourceItemId === inventoryOccupants[0]?.id
          ? inventoryOccupants[0] : null;
        outgoingId = reviewed.blocked && outgoing && draft.status === 'Ativo'
          && /^PDV\s+[0-9]+$/i.test(draft.location) ? outgoing.id : null;
        replacementPanel.hidden = !outgoingId;
        if (outgoingId) {
          replacementPanel.querySelector('[data-local-outgoing]').textContent =
            `${outgoing.equipment} · ${outgoing.tag || outgoing.serial} está em ${outgoing.location}. Escolha seu destino e condição final.`;
          form.elements.removedSector.value ||= outgoing.sector || draft.sector;
        }
      } catch (error) {
        if (reviewedRevision !== revision) return;
        reviewed = null; requestId = null;
        previewNode.textContent = error.message || 'Não foi possível conferir o local.';
      } finally { reviewButton.disabled = false; }
    });
    replacementButton.addEventListener('click', async () => {
      if (!outgoingId || !form.reportValidity()) return;
      const draft = values();
      const reviewedRevision = revision;
      if (!draft.removedLocation?.trim() || !draft.removedSector?.trim()) {
        previewNode.textContent = 'Informe o local e o setor finais do equipamento retirado.';
        return;
      }
      replacementButton.disabled = true;
      previewNode.textContent = 'Conferindo os dois equipamentos e o slot…';
      try {
        const result = await api.previewLocalReplacement(draft.itemId, outgoingId, draft);
        if (reviewedRevision !== revision) return;
        reviewed = result;
        mode = 'replacement'; requestId = crypto.randomUUID();
        previewNode.innerHTML = describeReplacement(reviewed);
        confirmButton.disabled = Boolean(reviewed.blocked);
      } catch (error) {
        if (reviewedRevision !== revision) return;
        reviewed = null; requestId = null;
        previewNode.textContent = error.message || 'Não foi possível conferir a substituição.';
      } finally { replacementButton.disabled = false; }
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!reviewed || reviewed.blocked || !requestId || !form.reportValidity()) return;
      confirmButton.disabled = true;
      const draft = values();
      try {
        const saved = mode === 'replacement'
          ? await api.confirmLocalReplacement(draft.itemId, outgoingId, draft, reviewed.token, requestId)
          : await api.confirmLocalRegularization(draft.itemId, draft, reviewed.token, requestId);
        close();
        window.AldeckotMessage?.show(mode === 'replacement'
          ? 'Substituição registrada com histórico nos dois equipamentos.'
          : 'Local conferido e histórico registrado.');
        await onSaved?.(saved);
      } catch (error) {
        previewNode.textContent = error.message || 'A alteração não foi registrada.';
        reviewed = null; requestId = null;
      }
    });
    host.querySelector('[name="itemId"]')?.focus();
  }

  window.AldeckotLocalRegularization = { open, close, peripheralTag };
})();
