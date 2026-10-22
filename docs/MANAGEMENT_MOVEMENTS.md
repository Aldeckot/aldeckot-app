# Gestão TI: posições, computadores e movimentações

Este documento registra o contrato funcional confirmado para a evolução da Gestão TI.
Nenhuma correção abaixo autoriza alterar dados reais sem validar os vínculos atuais.

## Donos dos dados

- Gestão TI é a fonte dos computadores, TAGs, local físico, status e histórico de movimentações. Os 20 PCs atuais **não** precisam de cadastro correspondente no Inventário e não devem ser duplicados lá.
- Inventário é a fonte dos demais equipamentos, inclusive periféricos. Um periférico instalado em PDV pertence à posição física, não ao PC ocupante.
- Controle TI recebe somente ocorrências de manutenção/defeito. Reserva não abre chamado.
- A posição/terminal foi confirmada como referência para a ocupação das posições existentes. O campo `location` divergente é dado legado a reconciliar; não o usar para inferir outra ocupação. Posições como PDV 10 são terminais; Matriz e Sala CPD são locais físicos, nunca novos terminais.

## Locais confirmados

- Reserva: **Sala CPD**.
- Manutenção: **Matriz**.
- Defeito: **Sala CPD**.

O local final deve ser mostrado e confirmado pelo usuário antes de toda movimentação. Status não é local. Outros nomes existentes em registros não autorizam criar um novo cadastro de local nem atribuir um destino automaticamente.

## Estado atual e riscos

O preflight de 17/10/2026 encontrou 33 posições, 20 ocupadas, 13 vazias, 16 com periféricos e nenhuma TAG duplicada na Gestão TI. Os 20 PCs não têm correspondência no Inventário, conforme a separação de responsabilidades acima. Há 12 registros ocupados cujo `location` difere de `terminal`; 10 são a sequência PDV 05–14, um é RH e um é Caixa 10. Caixa 15 já ocupa PDV 10; não pode ser tratado como reserva livre no cenário de substituição.

O usuário esclareceu que Caixa 10 está fisicamente na Sala CPD, referência `RES 02`, com **Defeito**. O preflight antigo mostrava Manutenção, mas a auditoria posterior já confirmou o status corrigido para Defeito: não repetir a atualização nem registrar envio à Matriz. O registro ainda usa a posição `RES 01`; esse vínculo não pode ser alterado automaticamente sem nova verificação. Essa exceção impede a regra simplista `location = terminal` para todos os PCs.

A auditoria inicial encontrou quatro chamados vinculados à Gestão TI e dois cruzamentos com TAG/série identificáveis. A primeira tentativa da 084 foi cancelada integralmente porque a base já havia mudado. A rechecagem encontrou **três** chamados: o do Caixa 05 foi removido; o chamado ativo do Caixa 10 apontava ao Caixa 15; outros dois, já concluídos, não têm TAG nem série e por isso sua identidade histórica não pode ser provada. A 084 revisada foi aplicada e o relatório posterior confirmou **1 vínculo reparado, 0 divergências ativas, 2 históricos não verificáveis e ambas as travas instaladas**. Ela impede novos vínculos incompatíveis e que a edição ordinária do chamado mude automaticamente o status de um PC; a conclusão transacional existente permanece explícita. Não alterou posição, local, status ou histórico dos registros atuais.

A auditoria de periféricos encontrou 80 vínculos: 21 itens do Inventário por ID com `location` igual ao nome do PC, nenhum com `location` igual ao PDV e 59 entradas sem `sourceItemId`. A auditoria complementar resolveu os 59 por TAG única, sem ambiguidades, sem IDs repetidos e sem TAG reutilizada entre posições. Entre os 80 há 78 vínculos em PDVs, um monitor em ESTOQUE 01 e o MON010 no registro RES 01 do Caixa 10. Somente os 78 vínculos dos PDVs podem ser reconciliados pela posição confirmada; os outros dois não devem ter o local alterado por inferência. Em especial, não atribuir RES 01 ao MON010 enquanto o vínculo físico RES 01/RES 02 do Caixa 10 estiver divergente.

Hoje, `module_records.payload` mistura dados do terminal, computador, periféricos e históricos. A função `management_transfer_terminal(uuid, uuid)` da migração 056 troca o payload do computador incluindo `peripherals`, portanto desloca vínculos que deveriam ficar no PDV. O `location` é preservado junto ao terminal, de modo que a troca também não representa o destino físico confirmado de cada PC. O vínculo `control_items.management_record_id` e referências de Suprimentos usam o ID do registro de terminal; não podem ser reinterpretados silenciosamente como ID estável de computador. A sincronização de periféricos do Inventário ainda localiza a Gestão TI pelo nome do computador, não pelo terminal físico.

Por isso, a função de dois argumentos não satisfaz substituição ou transferência sem substituto. Uma migração apenas visual ou apenas de `location` não resolve esses vínculos.

## Contrato para a nova operação

Uma única operação de domínio deverá receber modalidade, PC que entra, PC que sai quando houver, posição física de destino, local final de cada PC, status final independente, motivo obrigatório, confirmação explícita dos locais e chave idempotente. Os modos são: substituir outro computador, ser substituído por outro computador e transferir sem substituição. As duas modalidades de substituição convergem para a mesma operação interna, com papéis de entrada/saída explícitos.

Antes da transação, o servidor deve validar identidade estável dos PCs, versão/vínculo de cada posição, TAGs, exclusividade da ocupação, compatibilidade entre status e local, origem e destino confirmados, permissões e periféricos. As posições e PCs envolvidos devem ser bloqueados em ordem estável; concorrência sobre o mesmo PDV deve falhar com conflito, nunca sobrescrever o primeiro commit. A chave idempotente deve devolver o resultado anterior sem duplicar logs, chamados ou eventos.

No commit, preservar o registro da posição e seus periféricos; atualizar apenas ocupação e estado dos PCs; registrar um identificador de operação compartilhado no histórico do PDV e nos históricos individuais; preparar eventual ocorrência do Controle TI na mesma transação ou numa outbox idempotente. Falha externa posterior não reverte uma operação principal já confirmada: fica rastreável e reprocessável.

## Pré-condições de migração

1. A migração 084 **revisada** foi aplicada e conferida no banco informado pelo usuário. Os dois chamados concluídos sem identidade ficam como pendência histórica explícita. O status Defeito e local `RES 02` do Caixa 10 já estavam corretos; preservar ambos e não alterar a referência de posição `RES 01` sem verificação.
2. O usuário confirmou a lista física de periféricos por PDV como correta. A migração 085 foi aplicada pelo usuário, e o pós-teste retornou 78 periféricos de PDV vinculados por ID, sem ID ausente, TAG divergente, módulo de origem divergente ou ID repetido. A migração 086 também foi aplicada: o pós-teste confirmou 78 localizações por PDV, nenhuma pelo nome do PC e ambas as travas ativas. O periférico fora dos PDVs não foi incluído. A operação de transferência de PCs continua separada e pendente.
3. A auditoria de referências posterior à 086 encontrou 33 posições, 20 PCs e somente três chamados vinculados à Gestão TI; não encontrou referências de Suprimentos ou Flux. Nenhum chamado identificável tem TAG/série divergente. Os dois chamados concluídos sem identidade comprovável permanecem exceções históricas. O usuário informou que aplicou a `087_management_computer_identity.sql` e o pós-teste confirmou 20 IDs distintos em 20 PCs, nenhuma divergência de ocupação e as duas travas ativas; o ambiente da aplicação ainda precisa ser confirmado. A 087 atribui `management_computer_id` nos próprios registros da Gestão TI, sem novos cadastros no Inventário ou alteração de posição. Os vínculos `management_record_id` continuam intactos nesta etapa.
4. Projetar histórico próprio de posição, histórico de PC e outbox/efeitos idempotentes reaproveitando `equipment_events` e `equipment_event_effects` quando possível.
5. Backfill aditivo e verificável. Preservar TAGs, séries, imagens, chamados, instalações de Suprimentos, periféricos e logs. Não fazer correção em massa de local sem aprovação dos casos ambíguos.
6. Só então substituir a RPC antiga, conectar o modal de cinco etapas e testar falha, reenvio, concorrência, ocupação dupla e os dois sentidos de substituição.

Até a aplicação e validação da nova operação de movimentação, não declarar o fluxo completo como implementado nem simular sucesso nas operações reais.

## Estado da 088 (instalação informada, validação parcial)

A migração 088 inclui a RPC `management_move_computer`, confirmação explícita
de status/local para cada PC, chave idempotente, bloqueio ordenado das posições,
verificação de versões, preservação dos periféricos no PDV e evento compartilhado.
O cliente agora chama apenas a RPC nova; a transferência legada continua
bloqueada. O modal possui cinco etapas, sem troca automática ao escolher um PDV.

A 088 agora também bloqueia no banco a mudança direta de um PC para **Ativo**
ou **Reserva** quando há chamado vinculado aberto no Controle TI (`Em manutenção`,
`Aguardando avaliação` ou `Em sala`). O bloqueio da RPC de movimentação continua
independente. A exceção exige o evento identificado da conclusão coordenada da
073, para o mesmo chamado, PC, status e transação; apenas alterar uma variável
de sessão não libera o PC. A execução local da rotina real da 073 revelou uma
ambiguidade entre as variáveis `source_module`/`source_id` e as colunas do evento;
a 088 recria a mesma função da 073 com a diretiva local
`#variable_conflict use_variable`, sem alterar sua lógica nem exigir permissão
para configurar `plpgsql.variable_conflict` no servidor. Uma tentativa anterior
de aplicar a 088 no SQL Editor falhou com erro 42501 ao usar `ALTER FUNCTION
... SET plpgsql.variable_conflict`. Após a correção, o usuário enviou auditoria
somente leitura com `migration_088_rpc_installed = true`, consulta do histórico
e trava de ativação instaladas. Nenhuma movimentação de teste foi executada
na base principal. Testes locais
cobrem edição direta, movimentação, Reserva, evento
não correspondente, conclusão real e reenvio sem duplicação. Isso não substitui
a validação integrada em um clone fiel do Supabase.

No PostgreSQL embarcado local, com 33 posições e 20 PCs fictícios, as migrações
087, 088 e 089 passaram nos cenários de troca nos dois sentidos, retirada para local
sem terminal, transferência direta, rollback por falha de chamado ou ausência
da tabela mensal do Controle TI, reenvio,
concorrência e histórico. O fixture agora carrega dos arquivos originais as
funções de identidade, guarda do PDV e sincronização com Controle TI; as
tabelas e demais gatilhos ainda são simplificados. Em teste de navegador isolado, o modal
passou nas duas entradas da substituição e na transferência direta para PDV
vazio, sem acessar o Supabase. Faltam validação contra um clone fiel do
Supabase, teste integrado entre navegador e RPC, regras de estorno e integração
externa reprocessável. Não executar movimentações de teste com dados reais.
O assistente local impede a escolha de substituto já instalado em outro PDV.
A migração incremental 089 prepara o mesmo bloqueio no servidor, além de
rejeitar status diferente de Ativo para o PC instalado em PDV. Ela conserva
a função transacional da 088 como implementação interna, remove seu acesso
direto e expõe a mesma RPC pública com revalidação sob bloqueio. A 089 foi
executada no PostgreSQL em memória e, em 21/10/2026, o usuário informou sua
aplicação no Supabase principal. A auditoria estrutural posterior confirmou
`migration_089_verified = true`. Ela não modifica registros antigos e não deve
ser reaplicada. Ainda falta conferir a integridade dos dados após a aplicação.

A aba Histórico da Gestão TI agora consulta separadamente os eventos imutáveis
do computador instalado (ID estável) e da posição física. Os registros legados
do terminal continuam visíveis em outra seção, mas logs com `eventId` não podem
ser editados ou apagados pela interface. Se a consulta da 088 estiver indisponível,
a aba mostra um aviso sem ocultar os registros legados. Testes de navegador
isolado cobrem o modal, a separação dos históricos e esse fallback; nenhum
chamou o Supabase principal. O histórico novo receberá dados somente após
movimentações reais autorizadas; o preflight informado mostrou zero eventos
de movimentação na data da consulta.

A migração 085 associou os 59 periféricos dos PDVs aos respectivos IDs patrimoniais, sem movimentá-los. O resultado foi conferido pelo usuário com a consulta posterior. A 084 corrigiu o chamado ativo, mas não tornou a transferência legada segura: suas travas recusam algumas trocas incompatíveis em vez de deixar o chamado passar para outro computador.

A 087 é apenas a base da identidade de PC. Não implementa as três modalidades de transferência, não move chamados nem resolve os dois históricos sem TAG/série. A auditoria do cliente também identificou que a restauração de backup atual apaga/reinsere os registros de posição; na base com a 087, a trava impede essa operação antiga. Ela deve ser substituída por uma operação transacional que preserve as identidades. O usuário enviou o resultado esperado de `aldeckot-087-computer-identity-postflight.sql`. Até a entrega completa, não usar a transferência nem a restauração antigas.

O usuário definiu que a restauração deve preservar a ocupação atual dos PDVs, periféricos e históricos, recuperando apenas dados dos PCs. O cliente agora interrompe o método antigo antes de qualquer exclusão e informa que nenhuma informação foi alterada. A futura restauração deve localizar cada PC por `management_computer_id`, rejeitar backup cuja identidade não possa ser demonstrada, atualizar apenas campos técnicos autorizados e registrar a restauração sem apagar logs anteriores. Um backup antigo não pode ser associado a outro PC por nome ou posição presumida.
Os backups novos produzidos pela interface incluem `computerId` em cada PC; os backups anteriores ainda não contêm esse campo e exigirão validação adicional antes de qualquer recuperação.
