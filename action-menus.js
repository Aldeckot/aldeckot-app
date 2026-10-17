/* Menus compactos de ações para os detalhes dos módulos. Preserva os botões
   originais e, portanto, seus eventos e verificações de permissão. */
(() => {
  function wrap(container, buttons, label) {
    if (!container || container.querySelector(':scope > .aldeckot-more-menu') || buttons.some(button => !button)) return;
    const menu = document.createElement('details');
    menu.className = 'aldeckot-more-menu';
    const summary = document.createElement('summary');
    summary.textContent = '•••';
    summary.setAttribute('aria-label', label);
    summary.title = label;
    const list = document.createElement('div');
    list.className = 'aldeckot-more-menu-list';
    buttons[0].before(menu);
    for (const button of buttons) {
      button.classList.add('aldeckot-more-option');
      if (button.matches('.inv-log-action, .management-log-action')) {
        button.textContent = button.classList.contains('delete') || button.classList.contains('danger') ? 'Excluir' : 'Editar';
      }
      list.append(button);
    }
    menu.append(summary, list);
    menu.addEventListener('click', event => {
      if (event.target.closest('button')) menu.open = false;
    });
  }

  function enhance(root = document) {
    for (const trigger of root.querySelectorAll('[data-inv-action="toggle-active-table-actions"], [data-inv-action="toggle-item-actions"], [data-management-action="toggle-actions"]')) {
      trigger.textContent = '•••';
      trigger.setAttribute('aria-label', 'Ações');
      trigger.title = 'Ações';
    }
    for (const container of root.querySelectorAll('.inv-log-actions')) {
      wrap(container, [container.querySelector('.inv-log-action.edit'), container.querySelector('.inv-log-action.delete')], 'Ações do registro');
    }
    for (const container of root.querySelectorAll('.management-log-actions')) {
      wrap(container, [container.querySelector('.management-log-action:not(.danger)'), container.querySelector('.management-log-action.danger')], 'Ações do log');
    }
    for (const container of root.querySelectorAll('.nfe-modal-actions')) {
      const edit = container.querySelector('[data-nfe-edit]');
      const remove = container.querySelector('[data-nfe-delete]');
      if (edit && remove) wrap(container, [edit, remove], 'Ações da ocorrência');
    }
    for (const container of root.querySelectorAll('.sp-compat-card .sp-card-actions')) {
      wrap(container, [container.querySelector('[data-sp-action="compat-edit"]'), container.querySelector('[data-sp-action="compat-remove"]')], 'Ações da compatibilidade');
    }
    for (const container of root.querySelectorAll('.inventory-branch-admin')) {
      wrap(container, [container.querySelector('[data-inv-branch-edit]'), container.querySelector('[data-inv-branch-delete]')], 'Ações da ramificação');
    }
    for (const container of root.querySelectorAll('.inventory-table-actions-popover')) {
      wrap(container, [container.querySelector('[data-inv-edit-table]'), container.querySelector('[data-inv-delete-table]')], 'Ações da tabela');
    }
    for (const container of root.querySelectorAll('.agenda-modal .agenda-actions')) {
      const edit = container.querySelector('[data-agenda-edit-open]');
      const remove = container.querySelector('[data-agenda-delete]');
      if (edit && remove) wrap(container, [edit, remove], 'Ações do agendamento');
    }
    for (const container of root.querySelectorAll('.editor-actions')) {
      const remove = container.querySelector('[data-user-delete]');
      if (remove) wrap(container, [remove], 'Ações do usuário');
    }
    root.querySelectorAll('.equipment-footer > [data-inv-delete-item], .management-asset-footer > [data-management-action="edit"]')
      .forEach(button => button.remove());
  }

  window.AldeckotActionMenus = { enhance };
})();
