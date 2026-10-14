/* A prévia usa dados retornados pelo Supabase; esta camada não grava nada. */
((root, factory) => {
  const review = factory();
  if (typeof module === 'object' && module.exports) module.exports = review;
  if (root) root.AldeckotFluxReview = review;
})(typeof window !== 'undefined' ? window : null, () => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const sourceLabel = module => ({ inventory: 'Inventário', management: 'Gestão TI',
    control: 'Controle TI', flux: 'Flux' })[module] || 'Sem origem vinculada';
  const effects = (preview, values) => {
    const movement = values.movement === 'Envio' ? 'envio' : 'recebimento';
    const rows = [`Flux: registrar ${movement} — ${values.situation}.`];
    if (preview.linkedMaintenance) {
      rows.push(`${sourceLabel(preview.sourceModule)}: atualizar o equipamento para Manutenção.`);
      rows.push(`Controle TI: ${String(preview.controlAction || 'Criar').toLowerCase()} chamado de manutenção.`);
    } else rows.push('Módulo de origem: nenhuma mudança de status prevista por esta movimentação.');
    rows.push('Histórico: registrar a movimentação e seus efeitos confirmados.');
    return rows;
  };
  const describe = (preview, values) => ({
    title: `${values.movement} para ${values.situation}`,
    equipment: values.equipment,
    tag: values.tag,
    serial: values.serial,
    source: sourceLabel(preview.sourceModule),
    location: preview.sourceLocation || 'Não informada',
    destination: values.destinationCompany,
    previousStatus: preview.sourceStatus || 'Não informado',
    nextStatus: preview.newSourceStatus || preview.sourceStatus || 'Sem alteração',
    effects: effects(preview, values)
  });
  const confirm = (preview, values) => new Promise(resolve => {
    const summary = describe(preview, values);
    const layer = document.createElement('div');
    layer.className = 'flux-review-backdrop';
    layer.innerHTML = `<section class="flux-review-dialog" role="dialog" aria-modal="true" aria-labelledby="fluxReviewTitle">
      <header><h2 id="fluxReviewTitle">Confirmar movimentação</h2><button type="button" data-flux-review-cancel aria-label="Fechar">×</button></header>
      <div class="flux-review-body"><p class="flux-review-type">${escape(summary.title)}</p>
      <dl><dt>Equipamento</dt><dd>${escape(summary.equipment)}</dd><dt>TAG</dt><dd>${escape(summary.tag)}</dd>
      <dt>Nº de série</dt><dd>${escape(summary.serial)}</dd><dt>Módulo de origem</dt><dd>${escape(summary.source)}</dd>
      <dt>Local atual</dt><dd>${escape(summary.location)}</dd><dt>Destino</dt><dd>${escape(summary.destination)}</dd>
      <dt>Status atual</dt><dd>${escape(summary.previousStatus)}</dd><dt>Novo status</dt><dd>${escape(summary.nextStatus)}</dd></dl>
      <h3>Alterações previstas</h3><ul>${summary.effects.map(row => `<li>${escape(row)}</li>`).join('')}</ul>
      <p class="flux-review-note">Os dados serão conferidos novamente no servidor antes da gravação.</p></div>
      <footer><button type="button" data-flux-review-cancel>Cancelar</button><button type="button" data-flux-review-confirm>Confirmar movimentação</button></footer>
    </section>`;
    const finish = accepted => { document.removeEventListener('keydown', onKey); layer.remove(); resolve(accepted); };
    const onKey = event => { if (event.key === 'Escape') finish(false); };
    layer.querySelectorAll('[data-flux-review-cancel]').forEach(button => button.addEventListener('click', () => finish(false), { once: true }));
    layer.querySelector('[data-flux-review-confirm]').addEventListener('click', () => finish(true), { once: true });
    layer.addEventListener('click', event => { if (event.target === layer) finish(false); });
    document.addEventListener('keydown', onKey);
    document.body.append(layer);
    layer.querySelector('[data-flux-review-confirm]').focus();
  });
  return { describe, confirm };
});
