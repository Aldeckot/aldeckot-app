# Operação profissional do ALDECKOT

## Auditoria mensal automática

O endpoint `/api/monthly-audit-finalize` fecha e arquiva o relatório do mês anterior no primeiro dia de cada mês. Ele é executado pelo agendador da Vercel às 03:10 UTC (00:10 em São Paulo) e exige a variável de ambiente `CRON_SECRET` na Vercel.

O PDF final é salvo de forma privada no bucket `audit-reports`, em `finalizados/AAAA/MM/`. A interface continua permitindo visualizar, baixar e salvar relatórios parciais em qualquer data.

## Permissões operacionais

Após executar `031_operational_permissions_and_integrity.sql`, administradores podem conceder para cada usuário padrão as permissões de criar, editar, excluir e gerir backups em Inventário, Gestão TI, Controle TI, Flux e Fiscal NF-e. Em bancos que já executaram a primeira versão da 031, execute também `032_fix_centralized_validation.sql`.

## Integridade de equipamentos

A mesma migração evita TAGs e números de série repetidos dentro do mesmo módulo e expõe conflitos reais entre módulos para a Central de Operações. Um equipamento com a mesma TAG em Inventário, Gestão TI e Controle TI continua permitido para que a sincronização corporativa funcione.
