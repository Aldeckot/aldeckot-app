(() => {
  const MAX_NOTES = 10;
  const sizeSteps = [.8, 1, 1.2];
  const levels = {
    urgent: { label: 'Urgente', icon: '!' },
    maintenance: { label: 'Manutenção', icon: '⌕' },
    verify: { label: 'Verificar', icon: '?' },
    network: { label: 'Rede', icon: '⌁' },
    update: { label: 'Atualização', icon: '↑' },
    equipment: { label: 'Equipamentos', icon: '▣' }
  };
  let notes = [];
  let agendaReceived = false;
  let dragState = null;

  const safe = value => String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const api = () => window.AldeckotSupabase?.agenda;
  const canManage = () => Boolean(window.AldeckotAuth?.isAdmin);
  const notify = message => window.AldeckotMessage?.show(message);
  const localDate = () => new Date().toISOString().slice(0, 10);
  const identify = () => globalThis.crypto?.randomUUID?.() || String(Date.now()) + '-' + Math.random().toString(16).slice(2);
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const numeric = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const normalizeTasks = tasks => (Array.isArray(tasks) ? tasks : [])
    .map((task, index) => ({
      id: String(task?.id || identify()),
      title: String(task?.title || '').trim(),
      completed: Boolean(task?.completed),
      position: Number.isFinite(Number(task?.position)) ? Number(task.position) : index
    }))
    .filter(task => task.title)
    .sort((left, right) => left.position - right.position);
  const normalizeLayout = layout => {
    const value = layout && typeof layout === 'object' && !Array.isArray(layout) ? layout : {};
    const result = {};
    const x = numeric(value.x);
    const y = numeric(value.y);
    const scale = numeric(value.scale);
    const z = numeric(value.z);
    if (x !== null) result.x = clamp(x, 0, 100);
    if (y !== null) result.y = clamp(y, 0, 100);
    if (scale !== null) result.scale = clamp(scale, sizeSteps[0], sizeSteps.at(-1));
    if (z !== null) result.z = Math.max(1, Math.round(z));
    return result;
  };
  const noteLevel = note => levels[note.postitLevel] || levels.verify;
  const noteFinalized = note => {
    const tasks = normalizeTasks(note.postitTasks);
    return tasks.length > 0 && tasks.every(task => task.completed);
  };
  const activeNotes = () => notes.filter(note => !noteFinalized(note));
  const finalizedNotes = () => notes.filter(noteFinalized);
  const sortNotes = items => items
    .filter(item => item.kind === 'note')
    .map(item => ({ ...item, postitTasks: normalizeTasks(item.postitTasks), postitLayout: normalizeLayout(item.postitLayout) }))
    .sort((left, right) => (left.date + left.time + left.id).localeCompare(right.date + right.time + right.id));
  const automaticScale = total => total <= 3 ? 1 : total <= 5 ? .88 : total <= 7 ? .74 : .61;

  function defaultLayout(index, total) {
    if (total === 1) return { x: 28, y: 8, scale: 1, z: 1 };
    if (total === 2) return { x: 17 + (index * 27), y: 8, scale: 1, z: index + 1 };
    if (total <= 3) return { x: 4 + ((index % 3) * 19), y: 8, scale: 1, z: index + 1 };
    if (total <= 6) return { x: 4 + ((index % 3) * 19), y: 8 + (Math.floor(index / 3) * 40), scale: 1, z: index + 1 };
    return { x: 5 + ((index % 4) * 15), y: 8 + (Math.floor(index / 4) * 29), scale: 1, z: index + 1 };
  }

  function resolvedLayout(note, index, total) {
    return { ...defaultLayout(index, total), ...normalizeLayout(note.postitLayout) };
  }

  function board() {
    const home = document.querySelector('.home-reference');
    if (!home) return null;
    let element = home.querySelector('[data-postit-board]');
    if (!element) {
      element = document.createElement('section');
      element.className = 'postit-board';
      element.dataset.postitBoard = 'true';
      element.setAttribute('aria-label', 'Notas Post-it');
      home.appendChild(element);
    }
    return element;
  }

  function card(note, index, total) {
    const level = noteLevel(note);
    const tasks = normalizeTasks(note.postitTasks);
    const layout = resolvedLayout(note, index, total);
    const taskMarkup = tasks.map((task, taskIndex) => '<li class="' + (task.completed ? 'is-completed' : '') + '">'
      + '<label><input type="checkbox" data-postit-task="' + safe(note.id) + '" data-postit-task-index="' + taskIndex + '"'
      + (task.completed ? ' checked' : '') + '><span aria-hidden="true"></span><b>' + safe(task.title) + '</b></label></li>').join('');
    const deleteControl = canManage()
      ? '<button type="button" class="postit-note-delete" data-postit-delete="' + safe(note.id) + '" aria-label="Excluir Post-it ' + safe(note.title) + '" title="Excluir Post-it">×</button>'
      : '';
    const rotation = [-2.3, 1.35, -.7][index % 3];
    const style = 'left:' + layout.x + '%;top:' + layout.y + '%;z-index:' + layout.z + ';--postit-auto-scale:' + automaticScale(total) + ';--postit-manual-scale:' + layout.scale + ';--postit-rotation:' + rotation + 'deg';
    return '<article class="postit-note postit-' + safe(note.postitLevel || 'verify') + '" data-postit-id="' + safe(note.id) + '" style="' + style + '" aria-label="Nota ' + safe(note.title) + '. Arraste para reposicionar.">'
      + '<button type="button" class="postit-tape" data-postit-resize="' + safe(note.id) + '" aria-label="Ajustar tamanho da nota ' + safe(note.title) + '" title="Clique para ajustar o tamanho"></button>'
      + '<header><i aria-hidden="true">' + level.icon + '</i><div><small>' + level.label + '</small><h2>' + safe(note.title) + '</h2></div></header>'
      + '<ul class="postit-checklist">' + taskMarkup + '</ul>'
      + '<footer><span>' + safe(note.date || '') + (note.time ? ' · ' + safe(note.time) : '') + '</span><em>' + tasks.filter(task => task.completed).length + '/' + tasks.length + '</em></footer>'
      + deleteControl
      + '</article>';
  }

  function render() {
    const element = board();
    if (!element) return;
    const visible = activeNotes();
    element.dataset.postitCount = String(visible.length);
    element.innerHTML = visible.map((note, index) => card(note, index, visible.length)).join('');
    element.hidden = !visible.length;
    renderArchive();
  }

  function renderArchive() {
    const archived = finalizedNotes();
    document.querySelectorAll('[data-postit-archive-trigger]').forEach(trigger => {
      trigger.hidden = !archived.length;
      trigger.innerHTML = '<i aria-hidden="true">✓</i><span>Notas</span><b>' + archived.length + '</b>';
      trigger.title = 'Ver notas finalizadas';
    });
  }

  function archiveDialog() {
    const archived = finalizedNotes();
    if (!archived.length) {
      notify('Não há notas finalizadas no histórico.');
      return;
    }
    removeModal();
    const items = archived.map(note => {
      const tasks = normalizeTasks(note.postitTasks);
      const level = noteLevel(note);
      const actions = canManage()
        ? '<span class="postit-archive-row-actions"><button type="button" data-postit-restore="' + safe(note.id) + '" title="Restaurar nota">↶<span>Restaurar</span></button><button type="button" data-postit-archive-delete="' + safe(note.id) + '" title="Excluir nota">×<span>Excluir</span></button></span>'
        : '';
      return '<li><button type="button" class="postit-archive-open" data-postit-archive-open="' + safe(note.id) + '" aria-label="Abrir nota finalizada ' + safe(note.title) + '"><i aria-hidden="true">' + level.icon + '</i><span><b>' + safe(note.title) + '</b><small>' + safe(note.date || '') + (note.time ? ' · ' + safe(note.time) : '') + ' · ' + tasks.length + '/' + tasks.length + ' concluídas</small></span></button>' + actions + '</li>';
    }).join('');
    const dialog = document.createElement('div');
    dialog.className = 'postit-modal';
    dialog.innerHTML = '<div class="postit-dialog postit-archive-dialog" role="dialog" aria-modal="true" aria-label="Notas finalizadas">'
      + '<div class="postit-dialog-head"><div><small>Histórico preservado</small><h2>Notas finalizadas</h2></div><button type="button" data-postit-close aria-label="Fechar">×</button></div>'
      + '<p>Abra uma nota para visualizá-la ampliada. Você também pode restaurá-la ou excluí-la do histórico.</p><ul>' + items + '</ul>'
      + '<div class="postit-dialog-actions"><button type="button" data-postit-close>Fechar</button></div></div>';
    document.body.appendChild(dialog);
  }

  function expandedArchiveNote(id) {
    const note = finalizedNotes().find(item => item.id === id);
    if (!note) {
      archiveDialog();
      return;
    }
    removeModal();
    const level = noteLevel(note);
    const tasks = normalizeTasks(note.postitTasks);
    const checklist = tasks.map(task => '<li class="is-completed"><label><input type="checkbox" checked disabled><span aria-hidden="true"></span><b>' + safe(task.title) + '</b></label></li>').join('');
    const actions = canManage()
      ? '<button type="button" class="postit-restore" data-postit-restore="' + safe(note.id) + '">Restaurar nota</button><button type="button" class="postit-delete" data-postit-archive-delete="' + safe(note.id) + '">Excluir</button>'
      : '';
    const dialog = document.createElement('div');
    dialog.className = 'postit-modal';
    dialog.innerHTML = '<div class="postit-dialog postit-expanded-dialog" role="dialog" aria-modal="true" aria-label="Nota finalizada ' + safe(note.title) + '">'
      + '<div class="postit-dialog-head"><div><small>Histórico preservado</small><h2>Nota finalizada</h2></div><button type="button" data-postit-close aria-label="Fechar">×</button></div>'
      + '<article class="postit-note postit-' + safe(note.postitLevel || 'verify') + ' postit-expanded-preview" style="--postit-auto-scale:1;--postit-manual-scale:1;--postit-rotation:-1deg"><span class="postit-tape" aria-hidden="true"></span>'
      + '<header><i aria-hidden="true">' + level.icon + '</i><div><small>' + level.label + '</small><h2>' + safe(note.title) + '</h2></div></header>'
      + '<ul class="postit-checklist">' + checklist + '</ul>'
      + '<footer><span>' + safe(note.date || '') + (note.time ? ' · ' + safe(note.time) : '') + '</span><em>' + tasks.length + '/' + tasks.length + '</em></footer></article>'
      + '<div class="postit-dialog-actions"><button type="button" data-postit-history>Voltar ao histórico</button>' + actions + '</div></div>';
    document.body.appendChild(dialog);
  }

  async function restoreNote(id) {
    const note = finalizedNotes().find(item => item.id === id);
    if (!note) return;
    if (!canManage()) {
      notify('Somente administradores podem restaurar notas.');
      return;
    }
    const tasks = normalizeTasks(note.postitTasks).map(task => ({ ...task, completed: false }));
    try {
      const saved = await api().save({ ...note, postitTasks: tasks });
      notes = sortNotes(notes.map(item => item.id === id ? { ...note, ...saved, postitTasks: tasks } : item));
      removeModal();
      render();
      window.dispatchEvent(new CustomEvent('aldeckot:agenda-reload'));
      notify('Nota restaurada para a Home.');
      if (finalizedNotes().length) archiveDialog();
    } catch (error) {
      notify(error?.message || 'Não foi possível restaurar a nota.');
    }
  }

  function deleteNoteConfirmation(id) {
    const note = notes.find(item => item.id === id);
    if (!note) return;
    if (!canManage()) {
      notify('Somente administradores podem excluir notas.');
      return;
    }
    removeModal();
    const dialog = document.createElement('div');
    dialog.className = 'postit-modal';
    dialog.innerHTML = '<div class="postit-dialog postit-delete-dialog" role="dialog" aria-modal="true" aria-label="Excluir Post-it">'
      + '<div class="postit-dialog-head"><div><small>Confirmação necessária</small><h2>Excluir Post-it?</h2></div><button type="button" data-postit-close aria-label="Fechar">×</button></div>'
      + '<p>O Post-it <b>' + safe(note.title) + '</b> e suas tarefas serão removidos permanentemente.</p>'
      + '<div class="postit-dialog-actions"><button type="button" data-postit-close>Cancelar</button><button type="button" class="postit-delete" data-postit-confirm-delete="' + safe(note.id) + '">Excluir Post-it</button></div></div>';
    document.body.appendChild(dialog);
  }

  async function deleteNote(id) {
    const note = notes.find(item => item.id === id);
    if (!note) return;
    if (!canManage()) {
      notify('Somente administradores podem excluir notas.');
      return;
    }
    const wasArchived = finalizedNotes().some(item => item.id === id);
    try {
      await api().remove(id);
      notes = notes.filter(item => item.id !== id);
      removeModal();
      render();
      window.dispatchEvent(new CustomEvent('aldeckot:agenda-reload'));
      notify(wasArchived ? 'Nota removida do histórico.' : 'Post-it excluído da Home.');
      if (wasArchived && finalizedNotes().length) archiveDialog();
    } catch (error) {
      notify(error?.message || 'Não foi possível excluir a nota.');
    }
  }

  function removeModal() {
    document.querySelector('.postit-modal')?.remove();
  }

  function optionButtons(date) {
    removeModal();
    const dialog = document.createElement('div');
    dialog.className = 'postit-modal';
    dialog.innerHTML = '<div class="postit-dialog postit-choice-dialog" role="dialog" aria-modal="true" aria-label="Criar agendamento">'
      + '<div class="postit-dialog-head"><div><small>Agenda · ' + safe(date) + '</small><h2>O que deseja criar?</h2></div><button type="button" data-postit-close aria-label="Fechar">×</button></div>'
      + '<div class="postit-choice-list">'
      + '<button type="button" data-postit-choice="note" data-postit-date="' + safe(date) + '"><i>▣</i><span><b>Nota</b><small>Post-it com checklist na Home</small></span></button>'
      + '<button type="button" data-postit-choice="task" data-postit-date="' + safe(date) + '"><i>✓</i><span><b>Tarefa</b><small>Item da agenda com conclusão</small></span></button>'
      + '<button type="button" data-postit-choice="event" data-postit-date="' + safe(date) + '"><i>◷</i><span><b>Evento</b><small>Compromisso no calendário</small></span></button>'
      + '</div><div class="postit-dialog-actions"><button type="button" data-postit-close>Cancelar</button></div></div>';
    document.body.appendChild(dialog);
  }

  function noteForm(date) {
    if (!canManage()) {
      notify('Somente administradores podem criar notas.');
      return;
    }
    if (activeNotes().length >= MAX_NOTES) {
      notify('Limite de 10 notas Post-it atingido. Finalize as notas pendentes antes de criar outra.');
      return;
    }
    removeModal();
    const dialog = document.createElement('div');
    dialog.className = 'postit-modal';
    dialog.innerHTML = '<div class="postit-dialog" role="dialog" aria-modal="true" aria-label="Nova nota">'
      + '<div class="postit-dialog-head"><div><small>Agenda integrada</small><h2>Nova Nota Post-it</h2></div><button type="button" data-postit-close aria-label="Fechar">×</button></div>'
      + '<form data-postit-form><label>Título<input name="title" required maxlength="80" placeholder="Ex.: Revisar PDVs"></label>'
      + '<div class="postit-form-grid"><label>Data<input name="date" type="date" required value="' + safe(date || localDate()) + '"></label><label>Hora<input name="time" type="time" value="09:00"></label></div>'
      + '<div class="postit-form-grid"><label>Alerta<select name="reminder"><option value="0">No horário</option><option value="10">10 min antes</option><option value="30">30 min antes</option><option value="60">1 hora antes</option><option value="1440">1 dia antes</option></select></label>'
      + '<label>Nível<select name="postitLevel">' + Object.entries(levels).map(entry => '<option value="' + entry[0] + '">' + entry[1].label + '</option>').join('') + '</select></label></div>'
      + '<label>Tarefas<textarea name="tasks" required maxlength="900" placeholder="Uma tarefa por linha"></textarea><small>Após salvar, o conteúdo da nota fica bloqueado. Somente a conclusão das tarefas poderá ser alterada.</small></label>'
      + '<div class="postit-dialog-actions"><button type="button" data-postit-close>Cancelar</button><button class="postit-save">Salvar Nota</button></div></form></div>';
    document.body.appendChild(dialog);
    dialog.querySelector('[name="title"]').focus();
  }

  function taskPayload(text) {
    return String(text || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean).map((title, index) => ({
      id: identify(), title, completed: false, position: index
    }));
  }

  async function loadNotes() {
    try {
      await (window.AldeckotAuthReady || Promise.resolve());
      if (!window.AldeckotAuth?.session || !api()) return;
      notes = sortNotes(await api().load());
      render();
    } catch (error) {
      console.warn('Notas Post-it indisponíveis:', error?.message || error);
    }
  }

  async function saveNote(event) {
    const form = event.target.closest('[data-postit-form]');
    if (!form) return;
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const payload = {
      kind: 'note', title: data.title, date: data.date, time: data.time,
      reminder: Number(data.reminder), priority: 'normal', notes: '',
      postitLevel: data.postitLevel, postitTasks: taskPayload(data.tasks), postitLayout: {}
    };
    const button = form.querySelector('.postit-save');
    button.disabled = true;
    button.textContent = 'Salvando...';
    try {
      const saved = await api().save(payload);
      notes = sortNotes([...notes, { ...payload, ...saved, postitTasks: payload.postitTasks }]);
      removeModal();
      render();
      window.dispatchEvent(new CustomEvent('aldeckot:agenda-reload'));
      notify('Nota Post-it criada na Home.');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Salvar Nota';
      notify(error?.message || 'Não foi possível salvar a nota.');
    }
  }

  async function toggleTask(input) {
    const note = notes.find(item => item.id === input.dataset.postitTask);
    const index = Number(input.dataset.postitTaskIndex);
    if (!note || !Number.isInteger(index)) return;
    if (!canManage()) {
      input.checked = !input.checked;
      notify('Somente administradores podem atualizar a nota.');
      return;
    }
    const tasks = normalizeTasks(note.postitTasks);
    if (!tasks[index]) return;
    tasks[index].completed = input.checked;
    input.disabled = true;
    try {
      const saved = await api().save({ ...note, postitTasks: tasks });
      const finalized = tasks.every(task => task.completed);
      notes = sortNotes(notes.map(item => item.id === note.id ? { ...note, ...saved, postitTasks: tasks } : item));
      render();
      if (finalized) notify('Nota finalizada e movida para o histórico.');
    } catch (error) {
      input.checked = !input.checked;
      input.disabled = false;
      notify(error?.message || 'Não foi possível atualizar a tarefa.');
    }
  }

  function maximumLayer() {
    const visible = activeNotes();
    return visible.reduce((highest, note, index) => Math.max(highest, resolvedLayout(note, index, visible.length).z), 0);
  }

  function setCardLayout(element, layout) {
    element.style.left = layout.x + '%';
    element.style.top = layout.y + '%';
    element.style.zIndex = String(layout.z);
  }

  async function persistLayout(id, layout) {
    const previous = notes.find(note => note.id === id);
    if (!previous) return;
    const nextLayout = normalizeLayout(layout);
    notes = notes.map(note => note.id === id ? { ...note, postitLayout: nextLayout } : note);
    try {
      const saved = await api().updatePostitLayout(id, nextLayout);
      notes = notes.map(note => note.id === id ? { ...note, postitLayout: normalizeLayout(saved.postitLayout || nextLayout) } : note);
    } catch (error) {
      notes = notes.map(note => note.id === id ? previous : note);
      render();
      notify(error?.message || 'Não foi possível salvar a posição da nota.');
    }
  }

  function resizeNote(id) {
    const note = notes.find(item => item.id === id);
    if (!note) return;
    if (!canManage()) {
      notify('Somente administradores podem ajustar o tamanho da nota.');
      return;
    }
    const current = normalizeLayout(note.postitLayout).scale || 1;
    const currentIndex = sizeSteps.findIndex(value => Math.abs(value - current) < .03);
    const scale = sizeSteps[(currentIndex < 0 ? 1 : currentIndex + 1) % sizeSteps.length];
    const layout = { ...normalizeLayout(note.postitLayout), scale };
    const cardElement = document.querySelector('[data-postit-id="' + CSS.escape(id) + '"]');
    if (cardElement) cardElement.style.setProperty('--postit-manual-scale', String(scale));
    persistLayout(id, layout);
    notify(scale > 1 ? 'Post-it ampliado.' : scale < 1 ? 'Post-it reduzido.' : 'Post-it no tamanho padrão.');
  }

  function startDrag(event) {
    const handle = event.target.closest('.postit-note > header');
    const element = handle?.closest('[data-postit-id]');
    if (!element || !handle || event.target.closest('input,button,label')) return;
    if (event.button !== undefined && event.button !== 0) return;
    if (!canManage()) {
      notify('Somente administradores podem reposicionar as notas.');
      return;
    }
    const id = element.dataset.postitId;
    const visible = activeNotes();
    const index = visible.findIndex(note => note.id === id);
    const note = visible[index];
    const area = board();
    if (!note || !area) return;
    const areaRect = area.getBoundingClientRect();
    const noteRect = element.getBoundingClientRect();
    if (!areaRect.width || !areaRect.height) return;
    const layout = { ...normalizeLayout(note.postitLayout), ...resolvedLayout(note, index, visible.length), z: maximumLayer() + 1 };
    setCardLayout(element, layout);
    element.classList.add('is-dragging');
    element.setPointerCapture?.(event.pointerId);
    dragState = {
      id, pointerId: event.pointerId, element, areaRect,
      noteWidthPercent: (noteRect.width / areaRect.width) * 100,
      noteHeightPercent: (noteRect.height / areaRect.height) * 100,
      startX: layout.x, startY: layout.y, pointerX: event.clientX, pointerY: event.clientY, layout
    };
    event.preventDefault();
  }

  function moveDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const x = clamp(dragState.startX + ((event.clientX - dragState.pointerX) / dragState.areaRect.width) * 100, 0, Math.max(0, 100 - dragState.noteWidthPercent));
    const y = clamp(dragState.startY + ((event.clientY - dragState.pointerY) / dragState.areaRect.height) * 100, 0, Math.max(0, 100 - dragState.noteHeightPercent));
    dragState.layout = { ...dragState.layout, x, y };
    setCardLayout(dragState.element, dragState.layout);
  }

  function finishDrag(event, cancelled = false) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const state = dragState;
    dragState = null;
    state.element.releasePointerCapture?.(event.pointerId);
    state.element.classList.remove('is-dragging');
    if (cancelled) {
      render();
      return;
    }
    persistLayout(state.id, state.layout);
  }

  window.addEventListener('aldeckot:agenda-create-request', event => {
    event.preventDefault();
    optionButtons(event.detail?.date || localDate());
  });

  window.addEventListener('aldeckot:agenda-ready', event => {
    agendaReceived = true;
    notes = sortNotes(event.detail?.entries || []);
    render();
  });

  window.addEventListener('aldeckot:agenda-widget-rendered', renderArchive);

  window.addEventListener('aldeckot:agenda-reload', loadNotes);
  window.addEventListener('aldeckot:realtime-change', event => {
    if (event.detail?.table === 'agenda_entries' && !event.detail?.silent) window.setTimeout(loadNotes, 220);
  });

  document.addEventListener('click', event => {
    if (event.target.closest('[data-postit-close]')) {
      removeModal();
      return;
    }
    const choice = event.target.closest('[data-postit-choice]');
    if (choice) {
      const date = choice.dataset.postitDate || localDate();
      if (choice.dataset.postitChoice === 'note') noteForm(date);
      else {
        removeModal();
        window.dispatchEvent(new CustomEvent('aldeckot:agenda-open-entry-form', {
          detail: { date, kind: choice.dataset.postitChoice }
        }));
      }
      return;
    }
    if (event.target.closest('[data-postit-archive-trigger]')) {
      archiveDialog();
      return;
    }
    const archiveOpen = event.target.closest('[data-postit-archive-open]');
    if (archiveOpen) {
      expandedArchiveNote(archiveOpen.dataset.postitArchiveOpen);
      return;
    }
    const restore = event.target.closest('[data-postit-restore]');
    if (restore) {
      restoreNote(restore.dataset.postitRestore);
      return;
    }
    const activeDelete = event.target.closest('[data-postit-delete]');
    if (activeDelete) {
      deleteNoteConfirmation(activeDelete.dataset.postitDelete);
      return;
    }
    const remove = event.target.closest('[data-postit-archive-delete]');
    if (remove) {
      deleteNoteConfirmation(remove.dataset.postitArchiveDelete);
      return;
    }
    const confirmRemove = event.target.closest('[data-postit-confirm-delete]');
    if (confirmRemove) {
      deleteNote(confirmRemove.dataset.postitConfirmDelete);
      return;
    }
    if (event.target.closest('[data-postit-history]')) {
      archiveDialog();
      return;
    }
    const resize = event.target.closest('[data-postit-resize]');
    if (resize) resizeNote(resize.dataset.postitResize);
  });

  document.addEventListener('pointerdown', startDrag);
  document.addEventListener('pointermove', moveDrag);
  document.addEventListener('pointerup', event => finishDrag(event));
  document.addEventListener('pointercancel', event => finishDrag(event, true));
  document.addEventListener('change', event => {
    const task = event.target.closest('[data-postit-task]');
    if (task) toggleTask(task);
  });
  document.addEventListener('submit', saveNote);

  window.setTimeout(() => {
    if (!agendaReceived) loadNotes();
  }, 900);
})();
