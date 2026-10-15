# Inventário global e compartilhamento (migração 080)

Na versão 2.1.1, o usuário informou que as migrações 079 e 080 foram aplicadas.
A aplicação da 081 ainda não foi confirmada; o frontend mantém a consulta de
compatibilidade para ramificações até que ela esteja disponível. O estado da
base real não foi verificado por esta validação local.

Esta entrega depende de `supabase/079_inventory_branches.sql` já aplicada. A migração
`supabase/080_inventory_global_sharing.sql` é aditiva: cria referências entre o
equipamento original e ramificações da mesma categoria, duas consultas globais e
índices. Ela não copia equipamentos, não altera TAGs, não redistribui itens por
nome e não modifica status ou localização.

Antes de aplicar na base real, faça backup e execute a 080 em homologação. Teste
com uma conta autenticada que tenha permissão de gestão do Inventário. Não é
suficiente executar as funções de consulta no SQL Editor sem contexto de usuário:
elas verificam a conta ativa e as políticas de acesso.

Após aplicar:

1. Abra o Inventário sem `?table=`. Confirme os cinco registros recentes,
   os totais globais dos gráficos e a pesquisa por TAG, série, categoria e
   ramificação.
2. Use **Ver todos**, filtros e paginação. Compare o total com a quantidade
   de linhas originais em `inventory_items` das categorias do Inventário.
3. Em homologação, compartilhe um equipamento com uma segunda ramificação da
   mesma categoria. Verifique que ele aparece nas duas, mas tem um único ID,
   TAG, status, localização e histórico. Confirme os eventos em
   `inventory_branch_events` e `inventory_item_logs`.
4. Tente repetir a associação e usar uma ramificação de outra categoria: as
   duas operações devem falhar. Remova o vínculo compartilhado e confirme que
   o equipamento original e seus logs permanecem.
5. Teste a restauração de um backup em uma base descartável; vínculos
   compartilhados precisam reaparecer associados aos novos IDs restaurados.

O frontend mostra um aviso de migração ausente se a 080 ainda não estiver
disponível. A aplicação da migração e os testes com dados reais não fazem parte
da validação local automatizada.

## Paginação da categoria e das ramificações (migração 081)

Após a 080, aplique `supabase/081_inventory_branch_pagination.sql` primeiro em
homologação e depois na base real, com backup prévio. A função nova consulta a
ramificação no servidor com filtros e páginas de 25 itens; não altera registros
nem cria cópias. Até sua aplicação, as ramificações continuam funcionais por
uma consulta de compatibilidade mais pesada, enquanto a categoria sem
ramificação já usa a consulta paginada da 080.

Confira uma categoria com mais de 25 equipamentos: a primeira página deve
mostrar 25, a segunda o restante e o rodapé deve indicar o total real. Repita
com busca, status, situação e uma ramificação compartilhada. A tela global de
alterados recentemente deve continuar mostrando apenas cinco itens. A mesma
TAG compartilhada deve manter um único ID, status e histórico.

As fotos exibidas no Inventário reutilizam os caminhos do Suprimentos, sem
copiar arquivos no Storage. Verifique um modelo com foto própria, outro com
apenas a foto do grupo e uma foto removida ou atualizada.
