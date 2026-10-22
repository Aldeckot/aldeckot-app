# MON0 → AJMON019: correção das referências duplicadas — 2.1.49

## Evidência recebida

O Inventário possui o cadastro c5c96233-c834-4397-81db-341dece769a0,
TAG MON0, local ESTOQUE01. Ele não precisa ser recriado.
A lista da posição c4a736eb-96da-4455-8845-bf6304f214d3 (ESTOQUE 01)
tem quatro referências ao mesmo sourceItemId.

Os identificadores visuais de duas entradas mencionam os IDs de AJMON018 e
AJMON022, mas os sourceItemId dessas entradas apontam a MON0. Não é seguro
restaurar supostos vínculos daqueles monitores pelo identificador visual.
Esta correção não altera seus cadastros nem inventa suas posições.

## Correção preparada, não executada em produção

[aldeckot-mon0-ajmon019-repair.sql](aldeckot-mon0-ajmon019-repair.sql) é um
script pontual de dados, não uma nova migração de estrutura. Usar após 093,
sem reaplicar as migrações anteriores.

- Bloqueia escritas concorrentes durante a transação e valida ID, TAG, local,
  posição e o conteúdo exato das quatro entradas auditadas.
- Recusa TAG AJMON019 pertencente a outro item, referências em outra posição,
  novas entradas ou metadados não auditados.
- Mantém a entrada de ID inventory-peripheral-c5c96233-c834-4397-81db-341dece769a0
  e retira as outras três referências redundantes, sem excluir equipamentos.
- Altera apenas a TAG patrimonial para AJMON019; o gatilho existente atualiza
  a associação preservada pelo mesmo sourceItemId.
- Preserva série, status, local, outros campos do item, computador, periféricos
  não envolvidos e históricos existentes.
- Registra um evento peripheral-identity-repair com cópia integral das listas
  de periféricos antes/depois, e um log associado no histórico do monitor.
  Não representa transferência física e não adiciona histórico ao PC.
- Reenvio após sucesso não duplica eventos, efeitos, vínculos ou logs.
- Qualquer falha, inclusive no registro do histórico, desfaz toda a correção.

O snapshot do evento permite recuperar as referências anteriores mediante
revisão; não deve ser restaurado automaticamente sobre um estado posterior.

## Prevenção local

Em supabase-client.js, removidos os auxiliares sem uso assignManagementPeripheral,
clearManagementPeripheral, appendPeripheralSyncLog e suas dependências exclusivas.
O primeiro sobrescrevia todas as entradas do mesmo tipo com a mesma identidade,
comportamento compatível com a inconsistência recebida. Não há prova de que esse
trecho tenha originado especificamente estes dados.

A rotina ativa syncManagementPeripheral continua delegando a escrita aos
gatilhos do banco, sem reatribuição pelo nome do PC. A proteção atual contra
vínculos duplicados não foi desativada. Não foi acrescentada garantia global
nova de unicidade para toda edição direta dos módulos.

## Testes executados em ambiente isolado

- Reprodução das quatro entradas exatas, incluindo seus IDs visuais divergentes.
- Correção com uma única associação e mesma identidade patrimonial.
- Preservação dos outros equipamentos, periféricos e histórico do PC.
- Recusa de TAG já existente em outro equipamento.
- Recusa de metadados novos não auditados e de vínculo extra em outra posição.
- Falha simulada na gravação do log: rollback das referências, TAG e evento.
- Evento contendo a cópia recuperável das entradas anteriores.
- Reexecução sem duplicidade.
- Teste de regressão do cliente impede reintroduzir os auxiliares removidos.

As verificações de projeto, versão, migrações e suíte Node são executadas pelos
comandos Node equivalentes aos scripts npm, indisponível neste ambiente.
O esquema de teste não é um clone integral da produção.

## Aplicação e confirmação

1. Executar o script pontual completo no SQL Editor.
2. Se surgir erro, não remover as validações nem excluir o monitor.
3. Após sucesso, reexecutar
   [aldeckot-093-monitor-relation-audit.sql](aldeckot-093-monitor-relation-audit.sql).
4. AJMON019 deve ter inventory_count=1, o ID original acima e exatamente
   um vínculo em ESTOQUE 01. O local ESTOQUE01 permanece válido.

Nenhuma modificação de produção, push ou deploy foi feita nesta entrega.
A correção manual do RH informada pelo usuário ainda requer confirmação
de persistência; não executar novamente o script antigo do RH sem necessidade.
