# Sala CPD e associação de equipamentos — versão 2.1.46

## Estado e escopo

A 091 e a 092 foram aplicadas pelo usuário. A auditoria enviada em 22/10/2026
confirma a regra e o gatilho da 092 ativos, sem conflitos nos 27 itens em CPD.
As instruções de aplicação abaixo registram a entrega anterior: não reaplicar.
A equivalência posterior Sala CPD = Matriz está na nova 093, ainda pendente;
veja [MONITOR_RELATION_093.md](MONITOR_RELATION_093.md).
Nenhum teste desta entrega modificou produção.
Não houve commit, push ou deploy. A 091 aplicada não foi alterada.

A regra é independente do tipo, prefixo da TAG e status: **Sala CPD é um
local físico sem associação de instalação a PC/terminal**. Reserva e Defeito
podem permanecer nesse local sem mudança automática de status.

## Alterações

- `supabase/092_inventory_cpd_unassigned.sql`: impede associação por nome
  coincidente com Sala CPD; remove o vínculo quando uma movimentação válida
  do Inventário leva o item ao CPD; recusa associação manual por ID ou TAG
  legada enquanto o item estiver nesse local. Preserva os registros patrimoniais.
- A instalação da regra é transacional e não altera equipamentos, posições
  ou históricos existentes. Se houver vínculo conflitante preexistente, a
  migração aborta, em vez de apagar vínculos ou inventar eventos retroativos.
- A retirada de periférico de PDV continua usando a RPC da 090, com motivo,
  evento único, histórico e proteção contra reenvio.
- `docs/aldeckot-092-cpd-assignment-audit.sql`: consulta somente leitura de
  conflitos CPD, posições atuais e candidatos para os monitores não vinculados.
- `tests/local-management/peripheral-location-integration.mjs`: cenários
  isolados da 092 acrescentados à integração 086/090/091.
- `e2e/management-movement-wizard.spec.mjs`: fixture AJMON e teste da exibição
  do monitor e status nas informações do PC.
- Versão sincronizada em package.json, package-lock.json, system-version.js
  e nas nove páginas HTML; documentação de implantação atualizada.

## Validações executadas

- 272 testes da suíte `node --test`: aprovados.
- Verificação de versão 2.1.46, integridade/sintaxe de 139 scripts e páginas,
  e verificação de migrações: aprovadas. O npm não está disponível no ambiente;
  os comandos Node equivalentes aos scripts verify/check:migrations foram executados.
- Integração SQL em PGlite, sem conexão externa: aprovada. Cobre AJMON,
  posição fixa, nove tipos de equipamento (incluindo tipo desconhecido e sem
  TAG), bloqueio de vínculos manuais, retirada para CPD, preservação de status,
  reenvio sem duplicação e rollback da instalação diante de vínculo conflitante.
- 14 testes Playwright das suítes management-movement-wizard e
  inventory-peripheral-installation: aprovados, usando clientes interceptados
  e dados fictícios. Incluem monitor AJMON visível, detalhe do ocupante atual,
  movimentações, histórico, modal, imagens e cor do quadro da TAG.

Esses testes não são um clone integral do Supabase nem comprovam todas as
interações de produção. Não foram feitas movimentações fictícias na base real.

## Antes de aplicar a 092

1. Executar no SQL Editor a consulta somente leitura
   [aldeckot-092-cpd-assignment-audit.sql](aldeckot-092-cpd-assignment-audit.sql).
2. Revisar `assignment_report`, principalmente `cpd_conflicts`. Se houver
   conflito, esclarecer o vínculo físico antes de qualquer correção de dados.
3. Com a revisão concluída e autorização expressa, aplicar apenas
   [092_inventory_cpd_unassigned.sql](../supabase/092_inventory_cpd_unassigned.sql).
   Não reaplicar 091 nem outras migrações anteriores.
4. Reexecutar a mesma auditoria: funções/gatilho devem estar presentes e
   `cpd_conflicts` vazio. Não testar movimentações fictícias em produção.

## Pendências preservadas

- AJMON015, AJMON016 e AJMON026 em Sala CPD: sem vínculo intencional.
- AJMON017/018 (INFO 01/02), AJMON020/021 (ESTOQUE02/03) e AJMON022
  (TESOURARIA): confirmar os destinos atuais. A auditoria oferece candidatos
  ignorando espaços, mas não os vincula automaticamente. TESOURARIA tem
  mais de uma posição histórica possível; não escolher por suposição.
- A diferença histórica de 78 para 65 vínculos de PDV continua sem causa
  comprovada pelos relatórios recebidos; a contagem AJMON não a explica sozinha.
- Persistem os limites anteriores de restauração/reversão e homologação
  documentados em ALDECKOT_089_090_ENTREGA.md. Esta entrega não os declara resolvidos.
