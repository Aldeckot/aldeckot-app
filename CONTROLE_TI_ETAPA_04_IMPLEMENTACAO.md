# Controle TI — Etapa 4: Central Operacional

## Entregue localmente

- Painel de chamados com contagens por estado, fila priorizada e atividade recente, sempre baseada em episódios técnicos identificados por UUID.
- Abas Visão geral, Todos, Em andamento e Histórico; busca, filtros e paginação de 10, 25, 50 ou 100 registros no servidor.
- Acesso da fila ao chamado exato no histórico do equipamento e apresentação compatível quando a migração nova ainda não estiver disponível.
- Consultas protegidas por conta ativa na migração `097_control_operational_center.sql`. Os dados do painel vêm de duas funções de leitura; a página não calcula totais a partir de uma amostra paginada.

## Limites intencionais

Esta etapa não cria intervenções formais, tarefas pendentes ou prazos. O painel não usa transições de estado como substituto de intervenções nem exibe zero fictício para indicadores ainda sem fonte confiável. Conclusões e tempo médio consideram somente transições efetivas, ignorando o backfill histórico. As etapas 6, 7 e 9 deverão fornecer as entidades e regras para completar esses indicadores.

## Validação e implantação

Em 24/10/2026, a sequência até a migração 097 passou no PostgreSQL local e isolado, com dados fictícios e rollback dos cenários. Passaram também as verificações de versão, estrutura e migrações, os testes unitários e 68 testes de interface. O Supabase principal e os dados de produção **não foram modificados**; 095–097 continuam pendentes de avaliação e aplicação controlada. Não aplicar a 097 isoladamente: ela depende da arquitetura criada na 095.
