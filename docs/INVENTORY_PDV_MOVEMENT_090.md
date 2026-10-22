# Movimentação de periféricos nos PDVs — pós-aplicação

O usuário informou que aplicou a 090 na base principal em 21/10/2026. A
auditoria estrutural posterior confirmou as RPCs, permissões e o gatilho
habilitado (`migration_090_verified = true`). **Não reaplicar.** Falta a
auditoria de integridade dos dados e não foram feitas movimentações de teste
na produção.

## O que foi validado localmente

- A alteração de Local de um periférico cadastrado no Inventário, envolvendo
  um PDV, cria um evento com ID único. O mesmo ID aparece no log individual
  do item e na Movimentação das posições de saída e entrada.
- A edição pelo Inventário exige o motivo e usa uma única operação
  transacional quando a 090 está disponível. O reenvio com o mesmo ID não
  cria outro evento; um ID repetido com dados diferentes é recusado.
- Dois envios simultâneos na instância descartável com o mesmo ID retornam
  o mesmo resultado. O gatilho real de `updated_at` da 001 foi incluído no
  teste: outra operação com a versão anterior é bloqueada sem novo evento.
- Em PostgreSQL 16 local descartável, duas sessões independentes disputaram
  o mesmo periférico. A segunda aguardou uma trava real. Reenviar o mesmo ID
  retornou o resultado original; enviar outro ID com a versão anterior foi
  recusado. Em ambos os casos restaram um evento, um log e um único local.
  O teste reproduzível está em
  `tests/local-management/peripheral-concurrency-postgres.mjs`.
- Após a 090, uma alteração direta de Local envolvendo PDV, sem motivo
  explícito, é recusada no banco. Isso inclui a RPC antiga de permuta quando
  chamada diretamente; a interface passa a usar a envoltória com motivo.
  Um teste adicional invocou a assinatura antiga com dois periféricos de
  PDVs e confirmou a recusa atômica: nenhum Local, evento, log ou registro
  de permuta foi alterado. A mesma assinatura permaneceu funcional numa
  permuta entre Sala CPD e Matriz, sem gerar evento fictício de PDV.
- O Histórico do computador não recebe o evento do periférico.
- A alteração de status ou o reenvio de um Local inalterado não cria outro
  evento.
- A permuta de dois itens usa um motivo único e correlaciona os dois eventos
  por operationId; cada periférico mantém seu event_id individual, ligado ao
  respectivo log e ao registro da permuta. O reenvio da mesma operação não
  duplica eventos ou logs, e um reenvio com motivo diferente é rejeitado.
- A substituição patrimonial mantém a assinatura, as validações e o retorno
  existentes da função da 061. Seu ID passa a correlacionar os dois movimentos
  físicos, e os dois logs que a rotina já gravava recebem os event_id
  correspondentes; nenhum log adicional é criado pelo gatilho da 090.
- Uma falha simulada na segunda etapa da permuta ou da substituição reverte
  os dois Locais, status, vínculos, eventos e logs.
- As migrações 086 e 090 foram executadas juntas em PostgreSQL descartável
  com 78 vínculos fictícios em 14 PDVs; a mudança entre PDVs atualizou os
  dois arrays físicos e manteve um único vínculo por ID patrimonial.
- Um PDV inexistente ou ambíguo bloqueia a gravação. Uma falha na transação
  desfaz tanto a localização quanto o evento e o log.
- A migração não reconstrói eventos antigos, altera periféricos existentes
  nem modifica os vínculos ou o histórico dos computadores.

## Pendências e riscos após a aplicação

- Antes da aplicação da 090, o cliente mantinha a gravação antiga para
  compatibilidade: o motivo ficava no log do Inventário, mas não havia evento
  estruturado na Movimentação do PDV. Nenhuma movimentação real foi usada
  para testar essa compatibilidade. Após a instalação informada, é necessário
  conferir o funcionamento com operações legítimas e monitorar erros, sem
  criar movimentações fictícias em produção.
- A busca no código local encontrou uma única chamada da RPC antiga de
  permuta: o fallback da interface, usado somente quando a RPC nova ainda
  não existe. A conta GitHub conectada não disponibilizou os repositórios
  da organização para uma busca abrangente, e o painel do Supabase não
  respondeu às duas tentativas de consulta nesta sessão. Portanto, **não
  há evidência suficiente para excluir clientes externos**. Após a 090,
  qualquer chamada antiga que mude o Local de um periférico em PDV falhará
  integralmente, sem movimentação parcial ou histórico incompleto; ela não
  será convertida silenciosamente para uma operação sem motivo. Antes da
  autorização de produção, consultar os logs de API do Supabase por
  `/rpc/inventory_swap_locations` e atualizar os clientes encontrados para
  `inventory_swap_locations_with_reason`. A ausência de chamadas nos logs
  disponíveis não prova ausência de clientes inativos. A consulta somente
  leitura [aldeckot-090-legacy-rpc-audit.sql](aldeckot-090-legacy-rpc-audit.sql)
  complementa essa verificação: mostra outras funções do banco que chamem
  a assinatura antiga, permissões, presença do agendador e contador de
  execuções se o rastreamento estiver habilitado. Ela foi validada no banco
  local sintético. O resultado enviado do banco principal em 21/10/2026
  mostrou zero referências em outras rotinas SQL, ausência da tabela de
  tarefas agendadas, acesso negado a `anon` e permitido a `authenticated`
  e `service_role`. `track_functions` está em `none`, portanto **não há
  contagem de chamadas**; isso não comprova ausência de clientes externos.
  A consulta [aldeckot-090-api-log-audit.sql](aldeckot-090-api-log-audit.sql)
  foi preparada para o Logs Explorer (fonte Logs, não SQL Editor do banco)
  a fim de agrupar as chamadas HTTP à assinatura antiga por agente e status,
  sem expor IPs. A execução no projeto principal não retornou chamadas no
  período de 24 horas pesquisado. A consulta diagnóstica confirmou que esse
  intervalo continha 3.573 eventos de gateway, 3.417 requisições REST e 459
  chamadas RPC, com zero menções a `inventory_swap_locations` no caminho ou
  URL. Isso valida a busca no período, mas não exclui clientes inativos ou
  chamadas anteriores à retenção disponível.
- A substituição patrimonial foi testada com as funções existentes da 061 e
  da 086 em esquema sintético. A consulta somente leitura executada na base
  principal em 21/10/2026 mostrou que a definição atual de
  `inventory_replace_equipment` corresponde à versão 061 preservada pela 090;
  a 090 ainda não estava instalada. Esse resultado elimina a divergência
  conhecida da função, mas deve ser reconfirmado antes da aplicação se houver
  outra alteração no banco. A consulta está em
  [aldeckot-090-replacement-preflight.sql](aldeckot-090-replacement-preflight.sql).
- O fallback da interface para a RPC antiga só deve atuar quando a 090 não
  estiver instalada. No projeto principal, a auditoria posterior informa a
  090 presente; chamadas externas à assinatura antiga envolvendo PDV serão
  recusadas até que esses clientes adotem a RPC com motivo.
- Os testes de concorrência em PostgreSQL real e os testes integrados em
  PostgreSQL embarcado usam esquemas mínimos sintéticos. Ainda falta validar
  o conjunto inteiro do esquema em banco local isolado; nenhum desses testes
  autoriza movimentações nos dados de produção.
- As migrações 084–087 contêm guardas dependentes dos registros reais já
  auditados; executá-las em um banco vazio não reproduz o esquema em produção.
  A consulta somente leitura
  [aldeckot-090-schema-preflight.sql](aldeckot-090-schema-preflight.sql)
  confere colunas, tipos, funções e gatilhos exigidos pela 090 na base principal,
  sem consultar nem alterar equipamentos. O resultado enviado em 21/10/2026
  mostrou a 090 ainda não instalada, sem colunas ausentes ou alteradas, sem
  funções ausentes e sem gatilhos ausentes ou desativados. Ela complementa os
  testes locais, mas não substitui a validação com o esquema completo.

O usuário informou a aplicação da 090 no Supabase principal e enviou o
pós-teste estrutural esperado. A consulta somente leitura de integridade está
em [aldeckot-089-090-data-postflight.sql](aldeckot-089-090-data-postflight.sql);
seu resultado ainda não foi recebido.
