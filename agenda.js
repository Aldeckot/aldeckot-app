(() => {
  const releaseHomeRender = window.AldeckotHomeStage?.hold?.('agenda');
  let homeRenderReleased = false;
  const completeHomeRender = () => {
    if (homeRenderReleased) return;
    homeRenderReleased = true;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => releaseHomeRender?.()));
  };
  const today = new Date();
  let view = new Date(today.getFullYear(), today.getMonth(), 1);

  const pad = value => String(value).padStart(2, '0');
  const iso = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  let selectedDate = iso(today);
  const safe = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  let entries = [];
  const shownReminderKeys = new Set();
  const read = () => entries;
  const write = events => { entries = events; };
  const backend = () => window.AldeckotSupabase;
  const canManageAgenda = () => Boolean(window.AldeckotAuth?.isAdmin);
  const ensureHomeBackend = () => window.AldeckotHomeStage?.ready?.()
    || (typeof backend()?.init === 'function' ? backend().init() : Promise.resolve());
  const localeMonth = date => date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, char => char.toUpperCase());
  const priorityInfo = {
    urgent: { label: 'Urgente', icon: '🚨' },
    periodic: { label: 'Periódico', icon: '📅' },
    normal: { label: 'Normal', icon: '📋' }
  };
  const priorityOf = event => priorityInfo[event.priority] || priorityInfo.normal;

  function nextEvent(events) {
    const now = new Date();
    return events
      .filter(event => new Date(`${event.date}T${event.time || '23:59'}`) >= now)
      .sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`))[0];
  }

  function renderWidget(widget) {
    if (!widget || !document.body.contains(widget)) return;
    const events = read();
    const year = view.getFullYear();
    const month = view.getMonth();
    const startsAt = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dayCells = [];
    for (let index = 0; index < startsAt; index++) dayCells.push('<td></td>');
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateIso = iso(date);
      const dayEvents = events.filter(event => event.date === dateIso);
      const kinds = [...new Set(dayEvents.map(event => event.kind || 'event'))];
      const isToday = dateIso === iso(today);
      dayCells.push(`<td><button class="agenda-date ${isToday ? 'today' : ''}" data-date="${dateIso}" title="Adicionar ou ver lembretes">${day}${kinds.length ? `<span class="agenda-indicators">${kinds.map(kind => `<i class="agenda-dot ${kind === 'task' ? 'task' : 'event'}"></i>`).join('')}</span>` : ''}</button></td>`);
    }
    while (dayCells.length % 7) dayCells.push('<td></td>');
    const weeks = [];
    for (let index = 0; index < dayCells.length; index += 7) weeks.push(`<tr>${dayCells.slice(index, index + 7).join('')}</tr>`);
    const selectedEvents = events.filter(event => event.date === selectedDate).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const selectedLabel = new Date(`${selectedDate}T12:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    widget.innerHTML = `
      <div class="agenda-head">
        <div class="home-cal-title"><i>▣</i>${localeMonth(view)}</div>
        <div class="agenda-nav"><button data-agenda-nav="prev" title="Mês anterior">‹</button><button data-agenda-nav="next" title="Próximo mês">›</button></div>
      </div>
      <table class="agenda-table" aria-label="Calendário de compromissos"><thead><tr><th>D</th><th>S</th><th>T</th><th>Q</th><th>Q</th><th>S</th><th>S</th></tr></thead><tbody>${weeks.join('')}</tbody></table>
      <div class="agenda-summary">
        <div class="agenda-summary-text"><b>Agenda · ${selectedLabel}</b>${selectedEvents.length ? selectedEvents.slice(0, 1).map(event => `<button class="agenda-item" data-agenda-details="${event.id}">${safe(event.time || 'Sem horário')} · ${safe(event.title)}</button>`).join('') : 'Nenhuma tarefa ou evento'}</div>
        <button class="agenda-add" data-agenda-add-date="${selectedDate}" title="Novo lembrete">+</button>
      </div>`;
    widget.dataset.agendaReady = 'true';
  }

  function ensurePanels() {
    document.querySelectorAll('.home-reference').forEach(home => {
      const calendar = home.querySelector('.home-calendar');
      if (!calendar) return;
      let side = home.querySelector('.home-side');
      if (!side) {
        side = document.createElement('aside');
        side.className = 'home-side';
        home.appendChild(side);
      }
      if (calendar.parentElement !== side) side.appendChild(calendar);
      if (!side.querySelector('.agenda-upcoming-panel')) {
        const upcoming = document.createElement('section');
        upcoming.className = 'agenda-upcoming-panel';
        side.appendChild(upcoming);
      }
      if (!side.querySelector('.agenda-today-panel')) {
        const todayPanel = document.createElement('section');
        todayPanel.className = 'agenda-today-panel';
        side.appendChild(todayPanel);
      }
    });
  }

  function renderPanels() {
    const now = new Date();
    const events = read();
    const upcoming = events.filter(event => event.date >= iso(today))
      .sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`))
      .slice(0, 3);
    const todays = events.filter(event => event.date === iso(today)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    document.querySelectorAll('.agenda-upcoming-panel').forEach(panel => {
      panel.innerHTML = `<h3>Próximos agendamentos</h3>${upcoming.length ? `<div class="agenda-upcoming-list">${upcoming.map(event => `<button class="agenda-task agenda-task-compact ${event.kind === 'task' ? 'task' : 'event'}" data-agenda-details="${event.id}"><b>${safe(event.title)}</b><span>${safe(formatShort(event))}</span></button>`).join('')}</div>` : '<p>Nenhum agendamento próximo.</p>'}`;
    });
    document.querySelectorAll('.agenda-today-panel').forEach(panel => {
      panel.innerHTML = `<div class="agenda-panel-heading"><h3>Tarefas de hoje</h3><span>${today.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span></div>${todays.length ? `<div class="agenda-today-list">${todays.map(event => `<button class="agenda-task ${event.kind === 'task' ? 'task' : 'event'}" data-agenda-details="${event.id}"><div class="agenda-task-line"><b>${safe(event.title)}</b><i class="agenda-priority" title="${priorityOf(event).label}" aria-label="${priorityOf(event).label}">${priorityOf(event).icon}</i></div><span>${safe(event.time || 'Sem horário')} · ${event.kind === 'task' ? 'Tarefa' : 'Evento'}</span></button>`).join('')}</div>` : '<p>Nenhuma tarefa para hoje.</p>'}`;
    });
  }

  function renderAll() {
    ensurePanels();
    document.querySelectorAll('.home-calendar').forEach(renderWidget);
    renderPanels();
  }

  function formatShort(event) {
    const date = new Date(`${event.date}T12:00`);
    return `${event.kind === 'task' ? 'Tarefa' : 'Evento'} · ${date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} ${event.time ? `às ${event.time}` : ''}`;
  }

  function openForm(date, item) {
    if (item && !canManageAgenda()) { openDetails(item); return; }
    const existing = item || {};
    const dialog = document.createElement('div');
    dialog.className = 'agenda-modal';
    dialog.innerHTML = `<div class="agenda-dialog" role="dialog" aria-modal="true" aria-label="Lembrete">
      <div class="agenda-dialog-head"><h2>${item ? 'Editar lembrete' : 'Novo lembrete'}</h2><button class="agenda-close" data-agenda-close aria-label="Fechar">×</button></div>
      <form class="agenda-form" data-agenda-form>
        <label>Título<input name="title" required maxlength="80" placeholder="Ex.: Reunião com fornecedor" value="${safe(existing.title)}"></label>
        <div class="agenda-row"><label>Tipo<select name="kind"><option value="event" ${existing.kind !== 'task' ? 'selected' : ''}>Evento</option><option value="task" ${existing.kind === 'task' ? 'selected' : ''}>Tarefa</option></select></label><label>Data<input name="date" type="date" required value="${existing.date || date || iso(today)}"></label></div>
        <div class="agenda-row"><label>Horário<input name="time" type="time" value="${existing.time || '09:00'}"></label><label>Alerta<select name="reminder"><option value="0" ${String(existing.reminder) === '0' ? 'selected' : ''}>No horário</option><option value="10" ${String(existing.reminder) === '10' ? 'selected' : ''}>10 min antes</option><option value="30" ${String(existing.reminder) === '30' ? 'selected' : ''}>30 min antes</option><option value="60" ${String(existing.reminder) === '60' ? 'selected' : ''}>1 hora antes</option><option value="1440" ${String(existing.reminder) === '1440' ? 'selected' : ''}>1 dia antes</option></select></label></div>
        <label>Nível<select name="priority"><option value="urgent" ${existing.priority === 'urgent' ? 'selected' : ''}>Urgente</option><option value="periodic" ${existing.priority === 'periodic' ? 'selected' : ''}>Periódico</option><option value="normal" ${!existing.priority || existing.priority === 'normal' ? 'selected' : ''}>Normal</option></select></label>
        <label>Observações<textarea name="notes" placeholder="Detalhes, responsável ou local">${safe(existing.notes)}</textarea></label>
        <div class="agenda-actions">${item ? '<button type="button" class="agenda-delete" data-agenda-delete>Excluir</button>' : ''}<button type="button" class="agenda-cancel" data-agenda-close>Cancelar</button><button class="agenda-save">Salvar</button></div>
      </form>
    </div>`;
    dialog.dataset.editId = existing.id || '';
    document.body.appendChild(dialog);
    dialog.querySelector('input[name="title"]').focus();
  }

  function openDay(date) {
    const events = read()
      .filter(item => item.date === date)
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    if (!events.length) {
      openForm(date);
      return;
    }
    const readable = new Date(`${date}T12:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const dialog = document.createElement('div');
    dialog.className = 'agenda-modal';
    dialog.innerHTML = `<div class="agenda-dialog" role="dialog" aria-modal="true" aria-label="Agenda do dia"><div class="agenda-dialog-head"><h2>Agenda · ${readable}</h2><div class="agenda-dialog-head-actions"><button class="agenda-add" data-agenda-new-date="${date}" title="Novo lembrete">+</button><button class="agenda-close" data-agenda-close aria-label="Fechar">×</button></div></div><div class="agenda-list">${events.map(item => `<button data-agenda-open-id="${item.id}"><b>${safe(item.title)}</b><small>${safe(formatShort(item))}</small></button>`).join('')}</div></div>`;
    document.body.appendChild(dialog);
  }

  function openDetails(item) {
    if (!item) return;
    const date = new Date(`${item.date}T12:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const reminderNames = { 0: 'No horário', 10: '10 min antes', 30: '30 min antes', 60: '1 hora antes', 1440: '1 dia antes' };
    const dialog = document.createElement('div');
    dialog.className = 'agenda-modal';
    dialog.innerHTML = `<div class="agenda-dialog" role="dialog" aria-modal="true" aria-label="Detalhes do agendamento"><div class="agenda-dialog-head"><h2>${safe(item.title)}</h2><button class="agenda-close" data-agenda-close aria-label="Fechar">×</button></div><div class="agenda-details"><div><span>Tipo</span><b>${item.kind === 'task' ? 'Tarefa' : 'Evento'}</b></div><div><span>Data e hora</span><b>${date}${item.time ? ` às ${safe(item.time)}` : ''}</b></div><div><span>Alerta</span><b>${reminderNames[item.reminder] || 'No horário'}</b></div><div><span>Nível</span><b>${priorityOf(item).label}</b></div>${item.notes ? `<div class="agenda-details-full"><span>Observações</span><b>${safe(item.notes)}</b></div>` : ''}</div><div class="agenda-actions">${canManageAgenda() ? `<button class="agenda-delete" data-agenda-delete>Excluir</button>` : ''}<button class="agenda-cancel" data-agenda-close>Fechar</button>${canManageAgenda() ? `<button class="agenda-save" data-agenda-edit-open="${item.id}">Editar</button>` : ''}</div></div>`;
    dialog.dataset.editId = item.id;
    document.body.appendChild(dialog);
  }

  function closeModal() {
    document.querySelector('.agenda-modal')?.remove();
  }

  function showReminder(event) {
    if (document.querySelector('.agenda-reminder')) return;
    const alert = document.createElement('aside');
    alert.className = 'agenda-reminder';
    alert.innerHTML = `<button aria-label="Fechar" data-agenda-reminder-close>×</button><b><span class="agenda-reminder-icon" aria-hidden="true">⏰</span>Lembrete: ${safe(event.title)}</b><span>${safe(formatShort(event))}${event.notes ? ` · ${safe(event.notes)}` : ''}</span>`;
    document.body.appendChild(alert);
  }

  function checkAlerts() {
    const now = new Date();
    read().forEach(event => {
      if (!event.date || !event.time) return;
      const eventAt = new Date(`${event.date}T${event.time}`);
      const alertAt = new Date(eventAt.getTime() - Number(event.reminder || 0) * 60000);
      const key = `aldeckot-alert-${event.id}-${alertAt.getTime()}`;
      if (now >= alertAt && now - alertAt < 65000 && !shownReminderKeys.has(key)) {
        shownReminderKeys.add(key);
        showReminder(event);
      }
    });
  }

  document.addEventListener('click', event => {
    const navigation = event.target.closest('[data-agenda-nav]');
    if (navigation) {
      view = new Date(view.getFullYear(), view.getMonth() + (navigation.dataset.agendaNav === 'next' ? 1 : -1), 1);
      selectedDate = iso(view);
      renderAll();
      return;
    }
    const day = event.target.closest('.agenda-date[data-date]');
    if (day) {
      openDay(day.dataset.date);
      return;
    }
    const newForDay = event.target.closest('[data-agenda-new-date]');
    if (newForDay) {
      closeModal();
      openForm(newForDay.dataset.agendaNewDate);
      return;
    }
    const openItem = event.target.closest('[data-agenda-open-id]');
    if (openItem) {
      const item = read().find(entry => entry.id === openItem.dataset.agendaOpenId);
      closeModal();
      openForm(null, item);
      return;
    }
    const addForDate = event.target.closest('[data-agenda-add-date]');
    if (addForDate) {
      openForm(addForDate.dataset.agendaAddDate);
      return;
    }
    const detail = event.target.closest('[data-agenda-details]');
    if (detail) {
      openDetails(read().find(item => item.id === detail.dataset.agendaDetails));
      return;
    }
    const editOpen = event.target.closest('[data-agenda-edit-open]');
    if (editOpen) {
      const item = read().find(entry => entry.id === editOpen.dataset.agendaEditOpen);
      closeModal();
      openForm(null, item);
      return;
    }
    const edit = event.target.closest('[data-agenda-edit]');
    if (edit) {
      openForm(null, read().find(item => item.id === edit.dataset.agendaEdit));
      return;
    }
    if (event.target.closest('[data-agenda-close]')) {
      closeModal();
      return;
    }
    if (event.target.closest('[data-agenda-delete]')) {
      const modal = document.querySelector('.agenda-modal');
      backend().agenda.remove(modal.dataset.editId).then(() => {
        write(read().filter(item => item.id !== modal.dataset.editId));
        closeModal(); renderAll();
      }).catch(error => alert(error.message || 'Não foi possível excluir o agendamento.'));
      return;
    }
    if (event.target.closest('[data-agenda-reminder-close]')) document.querySelector('.agenda-reminder')?.remove();
  });

  document.addEventListener('submit', event => {
    const form = event.target.closest('[data-agenda-form]');
    if (!form) return;
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const modal = document.querySelector('.agenda-modal');
    const events = read();
    const item = { ...data, id: modal.dataset.editId || `${Date.now()}`, reminder: Number(data.reminder) };
    const isNew = !modal.dataset.editId;
    if (isNew) delete item.id;
    backend().agenda.save(item).then(saved => {
      const next = [...events];
      const index = next.findIndex(entry => entry.id === saved.id);
      if (index >= 0) next[index] = saved; else next.push(saved);
      write(next);
      view = new Date(`${saved.date}T12:00`);
      closeModal(); renderAll();
    }).catch(error => alert(error.message || 'Não foi possível salvar o agendamento.'));
  });

  async function bootstrapAgenda() {
    try {
      await (window.AldeckotAuthReady || Promise.resolve());
      if (!window.AldeckotAuth?.session) return;
      if (!backend()) throw new Error('Cliente Supabase não foi carregado.');
      await ensureHomeBackend();
      entries = await backend().agenda.load();
    } catch (error) {
      console.warn('Agenda indisponível:', error.message || error);
    }
    renderAll();
    completeHomeRender();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrapAgenda);
  else bootstrapAgenda();
  setInterval(checkAlerts, 30000);
  let agendaRealtimeTimer;
  window.addEventListener('aldeckot:realtime-change', event => {
    if (event.detail?.table !== 'agenda_entries') return;
    window.clearTimeout(agendaRealtimeTimer);
    agendaRealtimeTimer = window.setTimeout(bootstrapAgenda, 180);
  });
})();
