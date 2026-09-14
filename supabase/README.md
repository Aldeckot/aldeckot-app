# Migrações e segurança do banco

Esta pasta contém as migrações SQL do Supabase em ordem numérica. Elas compõem o histórico do banco do ALDECKOT.

## Aplicação

1. Faça uma cópia de segurança antes de qualquer alteração estrutural.
2. Execute apenas as migrações que ainda não existem no ambiente, em ordem crescente.
3. Registre a versão aplicada e valide o sistema depois da execução.
4. Nunca altere uma migração que já tenha sido executada em produção. Para uma correção, crie a próxima migração disponível.

O número `013` foi retirado antes da publicação e, por isso, não representa uma migração ausente. A verificação automática reconhece essa numeração como histórica.

As migrações `028_agenda_task_completion.sql` e `029_agenda_event_completion.sql` adicionam o estado de conclusão para tarefas e eventos exibidos na tela inicial. Execute as duas, em ordem, antes de publicar a interface com as caixas de conclusão.

A migração `030_monthly_audit_reports.sql` cria o arquivo privado de PDFs da Auditoria mensal. Ela permite que administradores consolidem tarefas e eventos concluídos, atualizações dos módulos e armazenem os relatórios por mês no bucket `audit-reports`.

A migração `038_inventory_management_peripheral_sync.sql` conecta Inventário e Gestão TI: quando a TAG compatível de um equipamento tem o Local igual ao nome de um computador instalado, o periférico correspondente recebe essa TAG automaticamente. Execute-a depois da `037_identity_update_validation.sql`.

A migração `039_fix_inventory_management_peripheral_sync_owner.sql` corrige a sincronização na base corporativa centralizada, que não possui o campo `owner_id` nos itens. Ela resolve o erro `record "new" has no field "owner_id"` ao cadastrar equipamentos. Execute-a após a `038` antes de voltar a cadastrar ou editar itens do Inventário.

A migração `040_reconcile_inventory_management_peripherals.sql` restaura o formato dos periféricos e sincroniza também os itens que já estavam cadastrados no Inventário. Execute-a após a `039`; o resultado exibirá quantos periféricos foram atualizados.

A migração `041_management_control_maintenance_sync.sql` conecta Gestão TI e Controle TI: todo terminal com **Status** de Manutenção/Defeito ou **Situação** Em Manutenção é incluído automaticamente na última tabela criada do Controle TI. Ela também reconcilia os terminais já marcados, sem duplicar equipamentos, e mantém status e histórico compartilhados entre os módulos.

A migração `042_fix_management_control_maintenance_owner.sql` corrige a inclusão automática quando a reconciliação é executada pelo SQL Editor em instalações que usam `owner_id`: ela atribui ao registro o proprietário do PC e da tabela de destino, em vez de depender da sessão do navegador. Na base corporativa centralizada, onde esse campo não existe, ela termina sem alterações para que a `043` assuma a sincronização compatível.

A migração `043_fix_central_management_control_maintenance_sync.sql` é a correção para a base corporativa centralizada, onde os registros não possuem `owner_id`. Execute-a após a `042`; ela detecta automaticamente instalações que ainda exigem proprietário em itens e logs, sem depender desse campo nos registros de Gestão TI.

A migração `044_route_management_maintenance_to_current_month.sql` direciona as manutenções automáticas para a tabela nomeada com o mês e ano atuais — por exemplo, `SETEMBRO 2026`. Ela também move para o mês atual os itens automáticos que haviam sido vinculados a uma tabela anterior. Execute-a após a `043`.

A migração `045_agenda_postit_notes.sql` cria as notas Post-it vinculadas à Agenda. Ela adiciona checklist, nível visual, limite transacional de nove notas por conta em instalações privadas ou por operação na base centralizada, e preserva as notas até sua remoção manual. Execute-a após a `044` antes de criar a primeira Nota na Home.

A migração `046_limit_agenda_postit_notes_to_four.sql` atualiza o limite transacional para **quatro** Post-its, mantendo a disposição visual de três notas na primeira linha e uma na segunda. Execute-a após a `045` antes de criar uma nova nota.

A migração `047_postit_free_layout_and_ten_limit.sql` permite arrastar livremente até **dez** Post-its ativos, inclusive sobrepostos, e salva suas posições e tamanhos. Ela bloqueia o conteúdo depois da criação, mantendo disponível apenas a conclusão das tarefas e o ajuste visual pelo adesivo superior. Ao concluir todas as tarefas, a nota sai da Home e permanece no histórico, onde pode ser aberta em visualização ampliada, restaurada ou excluída individualmente. Execute-a após a `045`; ela substitui a regra de quatro notas da `046` quando essa migração já tiver sido aplicada.

A migração `048_allow_agenda_postit_editing.sql` permite editar uma Nota Post-it ativa por meio de duplo clique no ícone do seu nível. Ela mantém protegida a conversão da nota para outro tipo de agendamento. Execute-a após a `047` antes de usar a edição de Post-its.

## Permissões

As migrações `015_authentication_and_permissions.sql` e `018_fiscal_nfe.sql` aplicam as políticas de acesso por usuário e função. Depois de publicar alterações de segurança, valide o bloqueio anônimo com:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL = 'https://seu-projeto.supabase.co'
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sua-chave-publica'
npm run verify:rls
```

O comando não grava nem remove dados. Ele confirma que as tabelas corporativas não podem ser lidas anonimamente.

## Dados sensíveis

Nunca registre no Git, em prints ou em mensagens:

- `SUPABASE_SERVICE_ROLE_KEY`
- arquivos `.env`
- `supabase-config.js`

Use a chave de serviço somente no ambiente seguro de administração/automação. A interface do navegador utiliza apenas a chave pública.
