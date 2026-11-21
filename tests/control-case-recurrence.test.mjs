import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration=readFileSync(new URL('../supabase/105_control_case_recurrence.sql',import.meta.url),'utf8');
const detail=readFileSync(new URL('../control-case-detail.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../supabase-client.js',import.meta.url),'utf8');

test('classificação de falha usa categorias fechadas e exige categoria ao resolver',()=>{
  assert.match(migration,/failure_category is null or failure_category in/);
  assert.match(migration,/category_text not in \('Alimentação elétrica'/);
  assert.match(migration,/prior\.failure_category<>category_text/);
  assert.match(detail,/failureCategories=\[/);
  assert.match(detail,/name="failureCategory" required/);
});

test('reincidência só agrega a identidade estável, não TAG nem série',()=>{
  assert.match(migration,/c\.source_module=current_case\.source_module\s+and c\.source_id=current_case\.source_id/);
  assert.match(migration,/not c\.requires_review/);
  assert.match(migration,/lag\(r\.created_at\) over\(partition by r\.failure_category/);
  assert.match(migration,/failure_category<>'Outro'/);
  assert.match(migration,/Mesmo UUID de origem e mesma categoria técnica estruturada/);
  assert.doesNotMatch(migration,/update public\.(inventory_items|module_records|control_items) set/);
  assert.match(client,/rpc\('control_case_recurrence'/);
});

test('reabertura do mesmo chamado não vira nova ocorrência e TAG reutilizada fica isolada',()=>{
  assert.match(migration,/distinct on\(c\.id\)/);
  assert.match(migration,/order by c\.id,r\.created_at desc,r\.id desc/);
  const sql=readFileSync(new URL('../tests/sql/control-case-reopen.sql',import.meta.url),'utf8');
  assert.match(sql,/00000000-0000-4000-8000-000000000023/);
  assert.match(sql,/00000000-0000-4000-8000-000000000998/);
  assert.match(sql,/deterministic evidence/);
});
