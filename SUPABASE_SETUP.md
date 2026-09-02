# Conectar o ALDECKOT ao Supabase

O site foi preparado para usar o Supabase como fonte única de dados do Inventário, Controle TI, Flux, Agenda e backups em rede. Não há dados de exemplo nem armazenamento local desses módulos.

## 1. Criar a estrutura do banco

1. Crie ou abra o projeto no Supabase.
2. Acesse **SQL Editor** e execute, nesta ordem, [001_aldeckot_schema.sql](supabase/001_aldeckot_schema.sql), [002_agenda_priority.sql](supabase/002_agenda_priority.sql), [003_control_ti.sql](supabase/003_control_ti.sql), [004_recent_activity.sql](supabase/004_recent_activity.sql), [005_equipment_central.sql](supabase/005_equipment_central.sql), [006_inventory_cleaning.sql](supabase/006_inventory_cleaning.sql), [007_control_inventory_status_sync.sql](supabase/007_control_inventory_status_sync.sql), [008_flux.sql](supabase/008_flux.sql), [009_flux_received_status.sql](supabase/009_flux_received_status.sql), [010_management_ti.sql](supabase/010_management_ti.sql), [011_management_backups.sql](supabase/011_management_backups.sql), [012_management_backup_settings.sql](supabase/012_management_backup_settings.sql) e, por último, [014_centralized_realtime.sql](supabase/014_centralized_realtime.sql).

Se o banco já estiver em uso, execute as migrações ainda pendentes e sempre finalize com [014_centralized_realtime.sql](supabase/014_centralized_realtime.sql). Ela consolida os dados que tenham vindo de navegadores diferentes, remove campos e políticas baseados em `owner_id`, `auth.uid()` ou ambiente por máquina, cria a política corporativa única e publica as tabelas no Supabase Realtime. Ela também é compatível se a antiga migração 013 tiver sido executada.

O ALDECKOT não usa login, sessão anônima, código de acesso ou filtro por computador. O Supabase passa a ser a fonte corporativa única: qualquer navegador com o link do site lê e altera a mesma base. Por esse modelo intencionalmente público, restrinja a divulgação do link de publicação. A chave `publishable` é própria para o frontend; nunca use uma chave `service_role` nele.

## 2. Inserir a Project URL e a chave publishable

Na raiz da pasta `aldeckot`:

1. Copie `.env.example` e renomeie a cópia para `.env`.
2. Preencha exatamente estas duas linhas no `.env`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://seu-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sua-chave-publishable
```

Encontre ambos os valores em **Supabase → Project Settings → API**. Use somente a chave `publishable` (ou a `anon` em projetos mais antigos). **Nunca** cole a `service_role` no site.

3. Na pasta `C:\Users\ricardon\Documents\Codex\2026-08-27\se-x20`, execute:

```powershell
& "C:\Users\ricardon\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" outputs\aldeckot\scripts\generate-supabase-config.mjs
```

O comando cria `supabase-config.js`, que é ignorado pelo Git. É esse arquivo que o navegador lê; o `.env` nunca é enviado ao navegador diretamente.

## Publicação no Vercel

Mantenha a **Root Directory** do projeto como a raiz do repositório e cadastre, em **Settings → Environment Variables**, as duas variáveis abaixo para os ambientes necessários (Production, Preview e Development):

```env
NEXT_PUBLIC_SUPABASE_URL=https://seu-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sua-chave-publishable
```

O arquivo `vercel.json` executa a geração de `outputs/aldeckot/supabase-config.js` durante cada build e publica a pasta `outputs/aldeckot`. Além disso, a rota `/api/supabase-config` lê essas mesmas variáveis durante a execução no Vercel; portanto, o ALDECKOT não depende do arquivo estático para conectar. A função também está presente dentro de `outputs/aldeckot/api`, cobrindo projetos configurados com essa pasta como Root Directory. Não use `service_role` no Vercel nem no frontend.

## 3. Abrir o site

Abra a pasta `outputs\aldeckot` usando um servidor local (por exemplo, Live Server) e navegue para `index.html`. Evite `file://` para a versão conectada, pois navegadores podem bloquear a comunicação segura com o Supabase nesse modo.

## Estrutura criada

| Entidade | Finalidade |
| --- | --- |
| `module_tables` | Listas/tabelas dos módulos |
| `inventory_items` | Equipamentos do Inventário |
| `inventory_item_logs` | Histórico de alterações dos equipamentos |
| `agenda_entries` | Eventos e tarefas da Agenda |
| `inventory_backups` | Snapshots de backup em rede |
| `inventory_backup_settings` | Preferência e agendamento do backup automático |
| `control_items` | Equipamentos e dados de manutenção do Controle TI |
| `control_item_logs` | Histórico de alterações dos equipamentos do Controle TI |
| `control_backups` | Snapshots de backup em rede do Controle TI |
| `control_backup_settings` | Preferência e agendamento do backup automático do Controle TI |
| `flux_items` | Movimentações de envio e recebimento de equipamentos do Flux |
| `flux_item_logs` | Histórico de alterações das movimentações do Flux |
| `flux_backups` | Snapshots de backup em rede do Flux |
| `flux_backup_settings` | Preferência e agendamento do backup automático do Flux |
| `module_records` | Dados flexíveis para Gestão TI e NF-e enquanto seus campos definitivos evoluem |
| `management_backups` | Snapshots de backup em rede da Gestão TI |
| `management_backup_settings` | Preferência e agendamento do backup automático da Gestão TI |
| `sync_events` | Auditoria de sincronizações, backups, restaurações e itens recentes exibidos na Home |
| Funções da Central | Busca unificada de TAG/série e linha do tempo dos módulos na Home |

Todas as tabelas corporativas têm RLS ativo com uma política comum de acesso sem filtro de usuário, chaves estrangeiras, índices e validação dos valores de Status e Situação. A migração 014 também habilita o Realtime para que alterações sejam entregues às outras telas conectadas imediatamente.

O botão de backup automático guarda sua preferência no banco. Quando o Inventário, o Controle TI, o Flux ou a Gestão TI for aberto ou sincronizado, o sistema cria uma cópia se já se passaram sete dias desde o último backup do respectivo módulo.

## Validação ponta a ponta

Depois de executar todas as migrações, incluindo a 014, execute o validador abaixo. Ele cria dados temporários, testa o acesso corporativo, Inventário, Controle TI, Flux, Agenda, Backups, Sincronização e a Central do Equipamento, e remove os registros de negócio ao final.

```powershell
& "C:\Users\ricardon\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" outputs\aldeckot\scripts\verify-supabase.mjs
```
