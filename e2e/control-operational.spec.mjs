import { expect,test } from '@playwright/test';

function fakeOperationalClient() {
  const user={id:'10000000-0000-4000-8000-000000000001'};
  const item={id:'item-001',equipment:'Monitor de teste',model:'P2422',
    brand:'Dell',tag:'TAG-001',serial:'SER-001',sector:'TI',
    status:'Aguardando avaliação',followUpKind:'maintenance',
    entryDate:'2026-10-22',situation:'Não realizada',notes:'Inspeção de teste',logs:[]};
  const table={id:'table-001',name:'OUTUBRO 2026',items:[item]};
  const olderTable={id:'table-002',name:'AGOSTO 2025',items:[{
    ...item,id:'older-item',tag:'TAG-ANTIGA',equipment:'Impressora de teste'
  }]};
  if (window.__controlPdfRows) {
    table.items.push(...Array.from({length:55},(_,index)=>({
      ...item,id:`pdf-${index}`,tag:`PDF-${String(index).padStart(3,'0')}`,
      equipment:index===54?'Balança de teste':`Monitor de teste ${index+1}`
    })));
  }
  const reportRows=[{id:'report-case-001',equipment:'Notebook fictício',tag:'TAG-001',sector:'TI',
    state:'Concluído',priority:'Alta',origin:'inventory',category:'Periféricos',openedAt:'2026-10-20T10:00:00Z',
    resolvedAt:'2026-10-20T13:00:00Z',maintenanceMinutes:90,interventions:2,recurrence:false,
    diagnosis:'Falha fictícia',solution:'Correção fictícia'}];
  const cases=Array.from({length:30},(_,index)=>({
    id:`case-${String(index+1).padStart(3,'0')}`,control_item_id:item.id,
    table_id:table.id,table_name:table.name,
    equipment:`Monitor fictício ${index+1}`,
    tag:`TAG-${String(index+1).padStart(3,'0')}`,
    serial:`SER-${String(index+1).padStart(3,'0')}`,
    sector:'TI',ticket_state:index===0?'Em manutenção':'Em diagnóstico',
    priority:index===0?'Alta':'Estável',
    followup_kind:'maintenance',opened_at:'2026-10-20T10:00:00Z'
  }));
  const query=()=>{let chain;chain=new Proxy({}, {get(_target,key){
    if(key==='then')return(resolve,reject)=>Promise.resolve({data:[],error:null}).then(resolve,reject);
    return()=>chain;
  }});return chain;};
  window.__operationalCalls=[];
  window.__reportCalls=[];
  window.AldeckotSupabase={
    init:async()=>({client:{from:query,storage:{from:()=>({createSignedUrl:async()=>({data:null,error:null})})}}}),
    auth:{state:async()=>({session:{user},user,profile:{id:user.id,full_name:'Teste local',
      role:'admin',status:'active',module_permissions:{}},isAdmin:true})},
    realtime:{subscribe:async()=>()=>{}},
    control:{
      load:async()=>({tables:[olderTable,table]}),
      operationalOverview:async()=>{
        if(window.__no097)throw {code:'PGRST202',message:'Function not found in schema cache'};
        window.__operationalCalls.push({kind:'overview'});
        return {periodStart:'2026-10-01',metrics:{open:30,verification:0,maintenance:1,
          waiting:0,testing:0,critical:1,completedPeriod:2,avgResolutionHours:4.5,
          overdue:window.__overdueTasks?1:null},queue:[{id:cases[0].id,tableId:table.id,controlItemId:item.id,
          equipment:cases[0].equipment,tag:cases[0].tag,sector:'TI',
          state:'Em manutenção',priority:'Alta',ageHours:48}],
          activity:[{id:'transition',caseId:cases[0].id,controlItemId:item.id,
            tableId:table.id,equipment:cases[0].equipment,tag:cases[0].tag,
            state:'Em manutenção',reason:'Diagnóstico confirmado',created_at:'2026-10-24T10:00:00Z'}],
          interventionsAvailable:!!window.__recentInterventions,
          interventions:window.__recentInterventions ? [{id:'intervention-001',caseId:cases[0].id,
            controlItemId:item.id,tableId:table.id,equipment:cases[0].equipment,
            type:'Inspeção',description:'Conferência técnica realizada',
            occurred_at:'2026-10-24T11:00:00Z'}] : [],
          tasksAvailable:!!window.__overdueTasks,
          overdueTasks:window.__overdueTasks ? [{id:'task-001',caseId:cases[0].id,
            controlItemId:item.id,tableId:table.id,equipment:cases[0].equipment,
            description:'Trocar fonte fictícia',priority:'Alta',state:'Pendente',
            due_at:'2020-01-02T10:00:00Z'}] : []};
      },
      operationalCases:async(filters)=>{
        window.__operationalCalls.push({kind:'cases',filters});
        let rows=cases.filter(entry=>
          (!filters.query||[entry.equipment,entry.tag,entry.serial].some(value=>value.toLowerCase().includes(filters.query.toLowerCase())))
          &&(!filters.status||entry.ticket_state===filters.status)
          &&(!filters.priority||entry.priority===filters.priority));
        const page=filters.page||1,size=filters.pageSize||25;
        return {total:rows.length,page,pageSize:size,items:rows.slice((page-1)*size,page*size)};
      },
      controlCaseReport:async(filters)=>{
        window.__reportCalls.push({...filters});
        return {periodStart:filters.periodStart||'2026-10-01',periodEnd:filters.periodEnd||'2026-10-24',
          metrics:{cases:1,resolvedCases:1,resolutionRate:100,avgResolutionHours:3,
            avgMaintenanceMinutes:90,recurrences:0,overdueTasks:0,interventions:2},
          states:[{label:'Concluído',count:1}],timeline:[{label:'2026-10-20',count:1}],
          sectors:[{label:'TI',count:1}],categories:[{label:'Periféricos',count:1}],
          origins:[{label:'inventory',count:1}],resolutionTimes:[{label:'TI',count:3}],
          casesList:reportRows,truncated:false};
      },
      listCases:async()=>[{id:'case-001',ticket_state:'Em manutenção',
        followup_kind:'maintenance',opened_at:'2026-10-20T10:00:00Z'}],
      syncManagementPeripheral:async()=>({state:'server-managed'})
    },
    controlBackups:{list:async()=>[],latest:async()=>null,
      settings:async()=>({automatic:false,frequency_days:7})}
  };
}
test.beforeEach(async({page})=>{
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1'&&url.pathname==='/supabase-client.js')
      return route.fulfill({contentType:'application/javascript',body:'('+fakeOperationalClient.toString()+')();'});
    if(url.hostname==='127.0.0.1'&&url.pathname==='/supabase-config.js')
      return route.fulfill({contentType:'application/javascript',body:'window.ALDECKOT_SUPABASE_CONFIG={};'});
    if(url.hostname==='cdn.jsdelivr.net')
      return route.fulfill({contentType:'application/javascript',body:''});
    if(url.hostname==='127.0.0.1'&&url.pathname.startsWith('/api/'))
      return route.fulfill({status:503,contentType:'application/json',body:'{}'});
    if(url.hostname==='127.0.0.1')return route.continue();
    return route.abort();
  });
});

test('painel mostra casos reais e não apresenta atividade como intervenção',async({page})=>{
  await page.goto('/control.html?view=operations');
  await expect(page.locator('.control-operational')).toBeVisible();
  await expect(page.locator('.control-op-metric.open')).toContainText('30');
  await expect(page.locator('.control-op-metric.critical')).toContainText('1');
  await expect(page.locator('.control-op-queue tbody tr')).toHaveCount(1);
  await expect(page.getByText('Mudanças de estado; não são intervenções')).toBeVisible();
  await expect(page.getByText('nenhum vencimento é presumido',{exact:false})).toBeVisible();
});

test('central apresenta uma pendência vencida e abre o chamado, não a tarefa',async({page})=>{
  await page.addInitScript(()=>{window.__overdueTasks=true;});
  await page.goto('/control.html?view=operations');
  const panel=page.locator('.control-op-card').filter({
    has:page.getByRole('heading',{name:'Pendências vencidas'})});
  await expect(panel).toContainText('Trocar fonte fictícia');
  await expect(panel.locator('li')).toHaveCount(1);
  await expect(panel.locator('.control-case-link')).toHaveAttribute('href',/case=case-001/);
  await expect(panel.locator('.control-case-link')).not.toHaveAttribute('href',/task-001/);
});

test('central mostra intervenção formal recente e abre o chamado, não o evento',async({page})=>{
  await page.addInitScript(()=>{window.__recentInterventions=true;});
  await page.goto('/control.html?view=operations');
  const panel=page.locator('.control-op-card').filter({has:page.getByRole('heading',{name:'Intervenções recentes'})});
  await expect(panel).toContainText('Conferência técnica realizada');
  await expect(panel.locator('.control-case-link')).toHaveAttribute('href',/case=case-001/);
  await expect(panel.locator('.control-case-link')).not.toHaveAttribute('href',/intervention-001/);
});

test('abas, busca e paginação usam a lista de chamados do servidor',async({page})=>{
  await page.goto('/control.html?view=operations');
  await page.locator('.control-op-tabs [data-control-tab="active"]').click();
  await expect(page.locator('.control-op-list tbody tr')).toHaveCount(25);
  await expect(page.locator('.control-op-pagination')).toContainText('30 chamados');
  await page.locator('[data-control-page-size]').selectOption('10');
  await expect(page.locator('.control-op-list tbody tr')).toHaveCount(10);
  await page.locator('[data-control-page="2"]').click();
  await expect(page.locator('.control-op-pagination')).toContainText('página 2 de 3');
  await page.locator('[data-control-query]').fill('TAG-029');
  await expect(page.locator('.control-op-list tbody tr')).toHaveCount(1);
  await expect(page.locator('.control-op-list')).toContainText('TAG-029');
  const call=await page.evaluate(()=>window.__operationalCalls.at(-1));
  expect(call.filters.query).toBe('TAG-029');
  expect(call.filters.page).toBe(1);
  expect(call.filters.pageSize).toBe(10);
});

test('relatórios aplicam filtros ao servidor e mantêm gráficos e totais distintos',async({page})=>{
  await page.goto('/control.html?view=operations');
  await page.locator('.control-op-tabs [data-control-tab="reports"]').click();
  await expect(page.getByRole('heading',{name:'Filtros do relatório'})).toBeVisible();
  await expect(page.locator('.control-report-chart')).toHaveCount(6);
  await expect(page.locator('.control-report-metrics')).toContainText('1');
  await expect(page.locator('.control-op-report tbody tr')).toHaveCount(1);
  await page.locator('[data-report-filter="category"]').selectOption('Periféricos');
  await expect.poll(()=>page.evaluate(()=>window.__reportCalls.at(-1)?.category)).toBe('Periféricos');
  await page.locator('[data-report-filter="maintenanceMode"]').selectOption('external');
  await expect.poll(()=>page.evaluate(()=>window.__reportCalls.at(-1)?.maintenanceMode)).toBe('external');
  await expect(page.locator('.control-op-report')).toContainText('2');
});

test('relatórios se ajustam a viewport estreita sem remover rolagem da tabela',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/control.html?view=operations');
  await page.locator('.control-op-tabs [data-control-tab="reports"]').click();
  await expect(page.locator('.control-report-filters')).toBeVisible();
  const table=page.locator('.control-op-report .control-op-table-wrap');
  await expect(table).toBeVisible();
  expect(await table.evaluate(element=>element.scrollWidth)).toBeGreaterThan(await table.evaluate(element=>element.clientWidth));
  expect(await page.locator('.control-op-report').evaluate(element=>element.scrollWidth)).toBeLessThanOrEqual(390);
});

test('fila abre o chamado selecionado no histórico do item correto',async({page})=>{
  await page.goto('/control.html?view=operations');
  await page.locator('.control-op-queue .control-case-link').click();
  await expect(page.getByRole('combobox', { name: 'Mês e ano' })).toHaveValue('table-001');
  await expect(page.locator('.inv-modal')).toBeVisible();
  await expect(page.locator('.control-case-focused')).toContainText('Chamado selecionado');
  await expect(page.locator('.control-case-focused')).toContainText('Em manutenção');
});

test('tabela mensal compacta o gráfico e a casa retorna à Central Operacional', async ({ page }) => {
  await page.setViewportSize({ width: 1453, height: 869 });
  await page.goto('/control.html?table=table-001');
  const nav = page.locator('.control-board-nav');
  await expect(nav.getByRole('button')).toHaveCount(1);
  await expect(nav.getByRole('button', { name: 'Início do Controle TI' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Mês e ano' })).toHaveValue('table-001');
  await expect(page.locator('.control-board-layout .inventory-chart')).toHaveCSS('width', '242px');
  const status = page.locator('.control-board-layout .inventory-chart-stage');
  await expect(status.getByTitle('Status a revisar: 1')).toBeVisible();
  const gap = await status.locator('.inventory-chart-bar').evaluateAll(bars =>
    bars[1].getBoundingClientRect().left - bars[0].getBoundingClientRect().right);
  expect(gap).toBeGreaterThan(0);
  expect(gap).toBeLessThanOrEqual(17);
  const signal = page.locator('.control-scene-signals path').first();
  await expect(signal).toHaveCSS('animation-name', 'control-scene-flow');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(signal).toHaveCSS('animation-name', 'none');
  await nav.getByRole('button', { name: 'Início do Controle TI' }).click();
  await expect(page.locator('.module-home-navigation')).toBeVisible();
  await expect(page.locator('.control-operational')).toBeVisible();
  await expect(nav).toHaveCount(0);
});

test('seletor percorre meses cadastrados, agrupa por ano e mantém a busca', async ({ page }) => {
  await page.goto('/control.html?table=table-001');
  const period = page.getByRole('combobox', { name: 'Mês e ano' });
  const previous = page.getByRole('button', { name: 'Mês anterior disponível' });
  const next = page.getByRole('button', { name: 'Mês seguinte disponível' });
  const search = page.getByRole('searchbox', { name: 'Buscar equipamento' });
  await expect(next).toBeDisabled();
  await expect(period.locator('optgroup[label="2025"]')).toHaveCount(1);
  await search.fill('Impressora');
  await previous.click();
  await expect(period).toHaveValue('table-002');
  await expect(search).toHaveValue('Impressora');
  await expect(page.getByRole('button', { name: 'Impressora de teste' })).toBeVisible();
  await expect(previous).toBeDisabled();
  await expect(period).toBeFocused();
  await next.click();
  await expect(period).toHaveValue('table-001');
});

test('PDF exporta todos os registros filtrados e permite trocar o mês na prévia', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.__controlPdfRows = true;
    window.print = () => {
      window.__printedTitle = document.title;
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  await page.setViewportSize({ width: 1453, height: 869 });
  await page.goto('/control.html?table=table-001');
  await page.getByRole('combobox', { name: 'Itens por página' }).selectOption('10');
  const search = page.getByRole('searchbox', { name: 'Buscar equipamento' });
  await search.fill('Monitor');
  await expect(page.locator('.control-board-table tbody tr')).toHaveCount(10);
  await page.getByRole('button', { name: 'Exportar PDF' }).click();
  const dialog = page.getByRole('dialog', { name: 'Exportar PDF' });
  const scope = dialog.getByRole('combobox', { name: 'Registros' });
  const period = dialog.getByRole('combobox', { name: 'Período' });
  const report = dialog.getByRole('table', { name: 'Equipamentos do relatório' });
  await expect(scope).toHaveValue('filtered');
  await expect(dialog.getByRole('status')).toHaveText('55 registros para exportar');
  await expect(report.locator('tbody tr')).toHaveCount(55);
  await expect(report.getByText('PDF-053')).toBeVisible();
  await expect(report.getByText('Balança de teste')).toHaveCount(0);
  await expect(report.getByRole('columnheader', { name: 'Limpeza' })).toBeVisible();
  await expect(report.getByRole('columnheader', { name: 'Observações' })).toBeVisible();
  await expect(report.getByText('Inspeção de teste').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Salvar como PDF' }).click();
  expect(await page.evaluate(() => window.__printedTitle)).toBe('aldeckot-controle-ti-outubro-2026-filtrado');
  const pdf = await page.pdf({ path: testInfo.outputPath('controle-ti.pdf'), preferCSSPageSize: true, printBackground: true });
  const contents = pdf.toString('latin1');
  expect(contents.match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(1);
  expect(contents).toMatch(/\/MediaBox \[0 0 84\d(?:\.\d+)? 59\d(?:\.\d+)?\]/);
  await scope.selectOption('all');
  await expect(dialog.getByRole('status')).toHaveText('56 registros para exportar');
  await period.selectOption('table-002');
  await expect(dialog.getByRole('status')).toHaveText('1 registro para exportar');
  await expect(scope.locator('option[value="filtered"]')).toHaveJSProperty('disabled', true);
  await expect(report.getByText('TAG-ANTIGA')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Mês e ano' })).toHaveValue('table-001');
});

test('consulta antiga continua acessível quando a migração 097 falta',async({page})=>{
  await page.addInitScript(()=>{window.__no097=true;});
  await page.goto('/control.html?view=operations');
  await expect(page.getByText('A Central Operacional requer a migração 097.',{exact:false})).toBeVisible();
  await expect(page.locator('.inventory-module-data')).toBeVisible();
});

test('central permanece legível em largura móvel sem rolagem horizontal da página',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/control.html?view=operations');
  await expect(page.locator('.control-op-metrics')).toBeVisible();
  await expect(page.locator('.control-op-tabs')).toBeVisible();
  const layout=await page.evaluate(()=>({
    pageWidth:document.documentElement.scrollWidth,
    viewportWidth:window.innerWidth,
    metricColumns:getComputedStyle(document.querySelector('.control-op-metrics')).gridTemplateColumns
  }));
  expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth+1);
  expect(layout.metricColumns.split(' ').length).toBeGreaterThan(0);
});
