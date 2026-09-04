# Conectar o ALDECKOT ao Supabase com acesso por usuário

O Supabase é a fonte central de dados do ALDECKOT. A partir desta versão, o site exige login: apenas contas **ativas** veem a base corporativa, e somente administradores podem alterar equipamentos, tabelas, logs e backups.

## 1. Aplicar as migrações

No **SQL Editor** do Supabase, execute as migrações históricas em ordem, terminando com:

1. [014_centralized_realtime.sql](supabase/014_centralized_realtime.sql)
2. [015_authentication_and_permissions.sql](supabase/015_authentication_and_permissions.sql)
3. [017_notification_acknowledgements.sql](supabase/017_notification_acknowledgements.sql)
4. [018_fiscal_nfe.sql](supabase/018_fiscal_nfe.sql)
5. [019_nfe_investigation_history.sql](supabase/019_nfe_investigation_history.sql)
6. [020_nfe_backup_settings.sql](supabase/020_nfe_backup_settings.sql)
7. [021_fix_nfe_delete_audit.sql](supabase/021_fix_nfe_delete_audit.sql)
8. [022_user_code_authentication.sql](supabase/022_user_code_authentication.sql)

Para um banco novo, execute também as migrações `001` até `012` antes dessas duas. A migração 015 substitui o acesso público que a 014 havia criado: restaura o RLS por conta/perfil, mantém a mesma base corporativa compartilhada e preserva o Realtime já configurado.

## 2. Variáveis de ambiente

No Vercel, em **Settings → Environment Variables**, cadastre estas variáveis em **Production**, **Preview** e **Development**:

```env
# Pode ir ao navegador: necessária para o cliente Supabase.
NEXT_PUBLIC_SUPABASE_URL=https://seu-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sua-chave-publishable

# Somente no servidor/Vercel: nunca inclua em supabase-config.js ou no frontend.
SUPABASE_SERVICE_ROLE_KEY=sua-chave-service-role
ALDECKOT_BOOTSTRAP_ADMIN_NAME=Nome do administrador inicial
# Código numérico usado para entrar no sistema (4 a 12 dígitos).
ALDECKOT_BOOTSTRAP_ADMIN_CODE=1014
# Somente identificador interno do Supabase Auth. Não é exibido nem usado para entrar.
ALDECKOT_BOOTSTRAP_ADMIN_EMAIL=admin@empresa.com
ALDECKOT_BOOTSTRAP_ADMIN_PASSWORD=uma-senha-forte-com-ao-menos-8-caracteres
```

A `SUPABASE_SERVICE_ROLE_KEY` é usada apenas pelas rotas serverless em `api/` para criar contas pendentes, inicializar o primeiro administrador, aprovar usuários e atualizar senhas com segurança. Ela nunca é enviada ao navegador, ao Git nem ao arquivo `supabase-config.js`.

Para desenvolvimento local, copie `.env.example` para `.env`, preencha os mesmos valores e execute:

```powershell
& "C:\Users\ricardon\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" outputs\aldeckot\scripts\generate-supabase-config.mjs
```

## 3. Primeiro acesso administrativo

Depois de publicar as variáveis e as migrações até a 022, abra `login.html`. A tela cria ou corrige o administrador inicial usando apenas as variáveis `ALDECKOT_BOOTSTRAP_ADMIN_*`. Em seguida, entre com o **código de usuário numérico** e senha. O valor `ALDECKOT_BOOTSTRAP_ADMIN_EMAIL` permanece somente como identificador técnico privado do Supabase Auth.

Não grave a senha inicial no projeto, em uma migração SQL ou no frontend. Após o primeiro acesso, ela pode ser alterada em **Configurações → Segurança**.

## 4. Fluxo de contas e permissões

| Perfil/situação | Acesso |
| --- | --- |
| Pendente | Não entra no sistema; aparece na aba **Configurações → Usuários** para aprovação. |
| Ativo padrão | Consulta Dashboard, Inventário, Gestão TI, Controle TI, Flux, Central do Equipamento e Central Fiscal NF-e (incluindo PDFs e auditoria); pode criar tarefas e eventos na Agenda, mas não pode criar, editar, excluir, restaurar ou criar backups fiscais. |
| Ativo administrador | Acesso integral, inclusive à Central Fiscal NF-e, Configurações → Usuários, aprovação, bloqueio, edição, redefinição de senha e exclusão de usuários. |
| Bloqueado | A sessão é recusada e a conta não acessa dados. |

Todas as ações administrativas de usuários ficam registradas em `user_audit_logs`, sem armazenar senhas. Equipamentos, gráficos, Central, Home, agenda e histórico continuam centralizados e recebem alterações via Supabase Realtime para as telas conectadas.

## 5. Publicação no Vercel

Mantenha a **Root Directory** do projeto como a raiz do repositório. O `vercel.json` gera `outputs/aldeckot/supabase-config.js` durante o build e publica `outputs/aldeckot`. As rotas em `outputs/aldeckot/api/` ficam no mesmo domínio do site.

Abra a versão conectada usando um servidor HTTP ou o endereço publicado. `file://` não suporta as rotas `/api` necessárias para login e administração de usuários.

## Estrutura relevante

| Recurso | Finalidade |
| --- | --- |
| `profiles` | Nome, código de usuário único, perfil e situação da conta vinculada ao Supabase Auth. |
| `user_audit_logs` | Auditoria administrativa de aprovações, bloqueios, edições e exclusões. |
| `api/auth-register.js` | Cadastro de novas solicitações pendentes. |
| `api/auth-bootstrap.js` | Inicialização segura do primeiro administrador pelo servidor. |
| `api/account.js` | Atualização da própria conta autenticada. |
| `api/admin-users.js` | Administração de usuários, exclusiva do perfil administrador. |
| `supabase/015_authentication_and_permissions.sql` | RLS por status/perfil e permissões corporativas. |
| `supabase/017_notification_acknowledgements.sql` | Reconhecimentos individuais da Central de Notificações, sincronizados em tempo real. |
| `supabase/018_fiscal_nfe.sql` | Tabelas Fiscal NF-e, auditoria, backups, bucket privado `nfe-pdfs`, RLS, métricas e Realtime. |
| `supabase/019_nfe_investigation_history.sql` | Histórico de PDVs sob investigação, solução auditada, RLS e Realtime. |
| `supabase/020_nfe_backup_settings.sql` | Configuração, histórico e Realtime do backup automático da Central Fiscal NF-e. |
| `supabase/021_fix_nfe_delete_audit.sql` | Corrige a auditoria de exclusão de NF-e e permite vários logs por ocorrência. |
| `supabase/022_user_code_authentication.sql` | Migra perfis existentes para códigos únicos e habilita login por código de usuário. |
