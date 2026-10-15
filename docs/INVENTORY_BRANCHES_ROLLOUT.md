# Inventário por ramificações — implantação e validação

## Estado desta entrega

Na versão 2.1.1, a migração `079_inventory_branches.sql` foi informada pelo usuário como aplicada. A primeira tentativa retornou `42703` porque a versão inicial referenciava `module_tables.owner_id`, removida pela migração 014; a correção foi aplicada antes da confirmação do usuário. Esta documentação não substitui uma conferência independente da base real. A classificação de itens ainda sem `branch_id` é calculada em leitura; a instalação da estrutura não atualiza equipamentos existentes.

## Arquitetura confirmada

- `module_tables` guarda as categorias reais do Inventário; `inventory_items` guarda os equipamentos por UUID e `table_id`.
- `inventory_item_logs` e a atividade recente já preservam o histórico e os links por UUID.
- Gestão TI vincula periféricos por ID/TAG e local, com sincronização no banco pelas migrações 038–040. Controle TI, Flux e Suprimentos também referenciam os itens patrimoniais, sem exigir tabelas separadas por ramificação.
- Suprimentos guarda imagens no bucket privado `supply-images`. O Inventário passa a reutilizar apenas o caminho assinado de modelo compatível (categoria, marca e modelo normalizados), sem upload ou exclusão de arquivo.

## Estrutura preparada

`079` adiciona `inventory_branches`, `inventory_items.branch_id` opcional e auditoria `inventory_branch_events`. O vínculo composto impede ramificação de outra categoria. As seis ramificações padrão são criadas somente para Balanças, Impressoras e Máquinas de Cartão já existentes. Nenhuma linha de `inventory_items` é atualizada durante a instalação.

Uma chave de classificação estável mantém os itens não migrados na mesma ramificação mesmo se o nome exibido for alterado. Criação, renomeação e exclusão passam por operações autorizadas; a exclusão é recusada quando houver equipamento explicitamente vinculado ou ainda classificado virtualmente. A permuta é transacional, idempotente por ID de operação, rejeita uma prévia desatualizada e modifica apenas `sector` e `location`, registrando logs nos dois equipamentos.

## Regras de classificação

| Categoria real | Correspondência no campo Equipamento | Ramificação proposta |
| --- | --- | --- |
| Balanças | Contém `Balança PDV` | Balanças de Checkout |
| Balanças | Demais nomes não vazios | Balanças de Setor |
| Impressoras | Igual a `Impressora Térmica` | Impressoras de Checkout |
| Impressoras | Demais nomes não vazios | Impressoras de Setor |
| Máquinas de Cartão | Igual a `Pin Pad` | Pin Pads de PDV |
| Máquinas de Cartão | Demais nomes não vazios | Maquininhas de Cartão |

Caixa, acentos e espaços repetidos são normalizados. Outras categorias não recebem ramificação automática. Uma escolha manual salva prevalece sobre a proposta.

## Simulação antes de dados reais

A ação **Prévia de organização** no Inventário gera, a partir da sessão autenticada, o relatório completo por categoria, TAG, ramificação atual/proposta e casos para revisão, com exportação JSON. Alternativamente, execute `node scripts/simulate-inventory-branches.mjs <backup-do-inventario.json>` sobre uma exportação local. A simulação não escreve no banco.

Nesta entrega não houve acesso autenticado aos equipamentos da base nem backup JSON fornecido, portanto não há contagens reais ou TAGs pendentes de revisão a declarar. Não inferir números a partir dos testes sintéticos.

## Retomada após o erro 42703

A versão corrigida da 079 não lê `module_tables.owner_id`. Ela pode ser executada inteira sobre uma base em que a tentativa anterior tenha parado: se a tabela de ramificações já tiver sido criada com `owner_id`, a coluna é preservada, mas deixa de ser obrigatória e de receber novos valores. A execução corrigida está envolvida em transação. Antes de retomá-la, confirme o estado da base e um backup recuperável; não execute somente o trecho após a linha do erro.

## Procedimento seguro para ambiente de teste e produção

1. Confirmar que as migrações 001–078 da base-alvo foram aplicadas, e obter backup recuperável do banco e dos arquivos `supply-images`. Testar a restauração em homologação.
2. Exportar o Inventário e executar a simulação; conferir totais por categoria e TAG, ambiguidades, vínculos com PDVs e saldos de Suprimentos.
3. Aplicar `079` primeiro em homologação, atualizar o schema cache do PostgREST e validar conta administrativa, RLS, categorias sem ramificação e com 1/2/várias ramificações.
4. Exercitar criação, renomeação, realocação manual, exclusão segura, busca, filtros, indicadores, últimas alterações, imagem compartilhada e permuta. Conferir os dois logs e os vínculos Gestão TI/Controle TI/Flux/Suprimentos após a permuta.
5. Repetir a simulação após a implantação. A aplicação de `079` por si só não faz backfill físico: `branch_id` dos equipamentos antigos continua nulo; a classificação é virtual até uma escolha manual ou um procedimento posterior de backfill validado.
6. Apenas após a comparação e o backup validado, repetir a implantação na base real. Se houver divergência, interromper as alterações e restaurar a cópia testada; não apagar tabelas ou recriar equipamentos como forma de reversão.

## Verificações desta entrega

- `node scripts/check-version.mjs`: versão sincronizada.
- `node scripts/check-project.mjs`: sintaxe e páginas essenciais válidas.
- `node scripts/check-migrations.mjs`: sequência de 78 migrações válida.
- `node --test`: testes de classificação, paginação e compatibilidade com a base centralizada.
- Integração autenticada com Supabase, execução SQL, teste visual em navegador e comparação de desempenho com dados reais: ainda não verificados neste ambiente. O teste `verify:supabase` cria/remove dados temporários e não foi executado contra produção.

## Limites conhecidos

A versão antiga do backup do Inventário já usa restauração destrutiva das categorias e itens. O formato novo inclui ramificações e preserva suas referências na restauração, mas recuperação de produção deve usar backup transacional do banco e ser testada separadamente. Imagens são exibidas apenas se categoria, marca e modelo forem compatíveis e houver acesso autorizado ao bucket; divergências não são associadas por aproximação. Não foi executada migração nem classificação física dos equipamentos existentes.
