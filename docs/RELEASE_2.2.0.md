# ALDECKOT 2.2.0 — entrega de código

Esta entrega foi preparada sobre a `main` publicada no commit `de9db80`, preservando o histórico do repositório. O código e as páginas exibem a versão `2.2.0`.

## Verificações

- `node scripts/check-version.mjs`: aprovado.
- `node scripts/check-project.mjs`: aprovado.
- `node scripts/check-migrations.mjs`: aprovado; as migrações existentes na `main` não foram alteradas.
- `node --test`: 372 testes aprovados.
- Playwright no Chrome local: 87 cenários aprovados; os dois cenários que presumiam o modo antigo da Central de Operações foram atualizados e aprovados novamente.
- `git diff --check`: aprovado. Nenhum arquivo de credenciais ou configuração local do Supabase foi incluído.

## Condição para publicar em produção

O código incorpora migrações de `095` a `130`. O histórico do repositório remoto termina em `094`; isso não comprova o estado atual do banco. A documentação local registra `112`–`120` somente no projeto de testes na última auditoria. Antes de promover esta branch à `main`, confirme no banco de produção a última migração aplicada, valide um backup recuperável e teste as migrações restantes no projeto de testes. Aplique apenas as pendentes, na ordem correta, e confirme os módulos e rotas após a implantação.

Nenhuma migração de produção nem atualização do domínio publicado faz parte deste commit.
