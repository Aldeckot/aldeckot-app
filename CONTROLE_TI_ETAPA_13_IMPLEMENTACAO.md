# Controle TI — Etapa 13: integração e integridade global

## Resultado da auditoria

A integração global já está implementada nas migrações `063`, `069`–`078`, `088`, `090` e `094`–`103`. A Etapa 13 não precisou criar outro barramento de eventos ou duplicar regras: isso evitaria duas fontes de verdade para o mesmo equipamento.

- A migração `063` define um evento raiz idempotente por origem/chave (`equipment_events`), um efeito por evento/módulo (`equipment_event_effects`) e referências opcionais nos logs históricos.
- A `095` preserva UUID de origem; uma identidade de Gestão TI só é aceita quando o vínculo aponta para um computador e a série confere. Correspondência ambígua fica marcada para revisão, sem unir por TAG. O índice parcial impede mais de um chamado aberto por item do Controle TI.
- A `072` processa manutenção de computador exclusivo da Gestão TI em transação coordenada com Flux e Controle TI, registra logs/efeitos associados ao mesmo evento e rejeita identidade ou efeitos prévios divergentes.
- A `073` exige escolha explícita do estado físico na conclusão, grava eventos e logs sob o mesmo identificador e suprime os gatilhos circulares durante a transação.
- A `103` só reabre chamado resolvido por ação explícita, motivo e chave idempotente; chamados concluídos/cancelados não reabrem. Uma manutenção posterior gera um novo episódio, não reabre o anterior.
- Os fluxos de aquisição/substituição e estorno (`060`, `069`–`071`, `075`–`078`) mantêm operações físicas explícitas, validações de identidade e proteção contra duplicidade.

## Evidências e limites

Foi acrescentada a regressão [`tests/global-integration.test.mjs`](tests/global-integration.test.mjs), cobrindo os contratos de evento, identidade, reabertura e rollback. A suíte Node completa passou com 342 testes; o PostgreSQL descartável passou pela cadeia de migrações e pelo cenário de Etapa 12. O roteiro `tests/local-management/rpc-integration.mjs` contém o cenário de falha injetada que verifica ausência de gravações parciais; ele foi inspecionado, mas não executado nesta rodada.

O banco efêmero usa PostgreSQL local sem rede e dados fictícios; não reproduz todos os serviços do Supabase. Nenhuma migração foi aplicada à produção, nenhum dado real foi alterado e não foi feito push.
