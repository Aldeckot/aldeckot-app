# Fechamento da etapa de movimentações — Gestão TI e Inventário

Estado conhecido em 21/10/2026. O usuário informou a aplicação das migrações 089 e 090 na base principal e enviou a auditoria estrutural posterior. **Não reaplicar as migrações.** Não executar movimentações de teste em dados reais; publicação da interface permanece uma decisão separada.

## Migrações aplicadas, em ordem, conforme informado pelo usuário

1. [089_management_movement_pdv_guard.sql](../supabase/089_management_movement_pdv_guard.sql) — acrescenta validações no servidor à movimentação de PCs da 088. Recusa substituto já instalado em outro PDV, origem indisponível e PC instalado em PDV com status final diferente de Ativo. Preserva o núcleo transacional da 088.
2. [090_inventory_pdv_movement_history.sql](../supabase/090_inventory_pdv_movement_history.sql) — registra movimentos físicos de periféricos no histórico dos PDVs e do próprio item, com motivo e ID de operação; adiciona as rotinas transacionais para edição e permuta e correlaciona os eventos de substituição patrimonial. Exige 063, 079, 086 e 088. Não cria eventos retroativos nem move registros existentes.

A migração [091_management_monitor_ajmon_assignment.sql](../supabase/091_management_monitor_ajmon_assignment.sql)
foi aplicada pelo usuário posteriormente para reconhecer TAGs `AJMON` e
reconciliar monitores por posição física. O relatório enviado com data
22/10/2026 00:39 UTC confirma 17 dos 25 monitores vinculados, sem ambiguidades
ou divergências de PDV. Três dos oito restantes estão intencionalmente em
Sala CPD; cinco têm destinos ainda não identificados. Isso não demonstra,
por si só, a causa da diferença histórica de 13 vínculos abaixo.
**Não reaplicar 084–091.** A proteção geral de Sala CPD está preparada na
092, ainda não aplicada: veja [CPD_ASSIGNMENT_092.md](CPD_ASSIGNMENT_092.md).

## Situação da base principal

- A instalação da 088 foi confirmada anteriormente por auditoria somente leitura.
- Às 17:54 UTC de 21/10/2026, o usuário enviou `deployment_report` com `migration_089_verified = true` e `migration_090_verified = true`. A função interna da 089 não é executável por `authenticated`; as RPCs e o gatilho da 090 aparecem presentes e habilitados. É uma verificação estrutural, não uma prova de funcionamento com dados reais.
- A auditoria anterior, às 17:38 UTC, havia mostrado a 090 não instalada e todas as suas dependências estruturais presentes. Isso registra o estado anterior à aplicação informada.
- O relatório anterior confirmou 78 periféricos vinculados por ID e localizados pelos PDVs, sem duplicação ou divergência de TAG.
- Às 18:01 UTC de 21/10/2026, o usuário enviou `data_report`: 33 posições, 20 PCs, 14 PDVs, zero divergências de identidade/TAG/local/origem e zero efeitos pendentes, mas **65 vínculos de periféricos em PDVs**, contra 78 na auditoria anterior, além de dois eventos de movimentação de PCs. A diferença de 13 ainda não foi explicada; o relatório não demonstra perda de registros, pois conta apenas os vínculos atuais nos PDVs. A consulta [aldeckot-089-090-peripheral-count-investigation.sql](aldeckot-089-090-peripheral-count-investigation.sql) localiza os vínculos atuais e os itens patrimoniais com local PDV sem vínculo correspondente, sem alterar dados. Suspender novas movimentações até entender a diferença.

## Conferência segura após a aplicação

1. A [auditoria estrutural](aldeckot-089-090-deployment-state.sql) já retornou todos os itens esperados como `true`; `migration_089_ready_to_apply = false` agora é o resultado correto, porque a 089 já existe.
2. A [auditoria de dados](aldeckot-089-090-data-postflight.sql) foi executada: as verificações de integridade passaram, mas o total de vínculos em PDVs caiu de 78 para 65. Executar a [investigação somente leitura](aldeckot-089-090-peripheral-count-investigation.sql) e enviar `investigation_report` antes de concluir a validação. Não assumir que a diferença seja corrupção ou operação legítima sem rastrear os 13 itens.
3. Conferir erros recentes do Supabase e a abertura dos módulos em leitura. Não fazer movimentações fictícias na base principal. Se surgir divergência, preservar os resultados e diagnosticar; não improvisar `DROP`, restauração ou reaplicação.

## Validação feita fora da produção

Os testes locais cobrem substituição nos dois sentidos, retirada para local sem terminal, transferências, conflito de ocupação, reenvio, concorrência, rollback, preservação de periféricos e histórico. A 090 também foi testada em PostgreSQL 16 descartável com sessões concorrentes e, em esquema sintético, com 78 vínculos em 14 PDVs. Os testes de interface usam navegador isolado. São dados fictícios; **não equivalem a um ensaio no esquema integral da produção**.

## Pendências e riscos explícitos

- Falta um clone fiel do Supabase para teste integrado ponta a ponta de navegador, RPC, gatilhos e permissões. Não existe homologação separada. Nenhum teste de movimentação deve ser feito na base principal.
- Em 24 horas de logs consultados antes da aplicação havia 459 chamadas RPC, nenhuma com menção à assinatura antiga `inventory_swap_locations`. A auditoria de catálogo encontrou zero rotinas SQL dependentes e nenhum agendador visível; isso **não exclui clientes externos inativos**. Agora, chamadas antigas que tentem mudar o Local de periféricos em PDV serão recusadas, exigindo atualização para a RPC com motivo. Monitorar erros de clientes após a mudança.
- A restauração antiga da Gestão TI continua bloqueada: falta o novo fluxo transacional que restaure apenas dados técnicos por ID estável, preservando ocupação, periféricos e históricos.
- A reversão controlada das movimentações e o reprocessamento de integrações externas ainda não estão completos/validados. Não declarar esses critérios concluídos.
- Dois chamados históricos já encerrados não têm TAG/série verificável; permaneceram preservados, sem reconciliação por suposição.
- A exceção de posição `RES 01` / local físico `RES 02` do Caixa 10 não deve ser corrigida automaticamente.
- Há alterações preexistentes no repositório; esta etapa não autoriza commit, push ou deploy. Separar e revisar a autoria antes de qualquer publicação.

Arquivos de contexto: [MANAGEMENT_MOVEMENTS.md](MANAGEMENT_MOVEMENTS.md) e [INVENTORY_PDV_MOVEMENT_090.md](INVENTORY_PDV_MOVEMENT_090.md). Eles contêm o escopo e os resultados detalhados dos testes anteriores.
