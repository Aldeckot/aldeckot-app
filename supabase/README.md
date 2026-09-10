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
