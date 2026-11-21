# Etapa 16 — Setores organizacionais

## Auditoria e decisão de segurança

O Inventário já possui um campo físico `sector` separado de `location`. A Etapa 15 adiciona trilha de transferência desse setor. A auditoria da 079–081 revelou que `inventory_branches` não representa somente localizações: também oferece classificações de categoria, associações compartilhadas e filtros de inventário (como “Balanças de Checkout” e “Impressoras de Setor”). Essas relações não podem ser convertidas cegamente em setores físicos sem perder significado ou vínculo. Por isso, a migração aditiva não renomeia nem exclui ramificações, memberships ou eventos.

## Implementação inicial

- `organizational-sectors.js` centraliza os nove setores padronizados e preserva como opção histórica qualquer rótulo atual fora da lista.
- A migração `108_organizational_sectors.sql` cria catálogo global com leitura restrita a contas ativas, adiciona `sector_code` ao Inventário e mapeia apenas correspondências normalizadas conhecidas. O texto histórico e o campo Local permanecem intactos.
- O formulário de Inventário/Controle TI usa o catálogo comum para o campo Setor; Gestão TI usa o mesmo catálogo. O carregamento do script é compartilhado pelas páginas relevantes.
- A busca por TAG/série no Controle TI preenche a identificação, Setor e Local oficiais de Inventário, Gestão TI ou Suprimentos, preserva o vínculo de origem e bloqueia os campos oficiais no módulo consumidor. A busca de Flux também devolve Setor e Local oficiais; os campos ficam bloqueados quando há vínculo.
- A migração `109_flux_sector_catalog.sql` adiciona Setor, código do catálogo e Local nos registros Flux, preserva o histórico sem inventar classificações, e atualiza a busca central para retornar os dados físicos corretos.
- Cadastros futuros do Inventário recebem o código do catálogo pelo gatilho, sem precisar criar uma lista por tabela. Valores desconhecidos permanecem sem classificação até revisão explícita.

## Validação e pendências

`tests/sql/inventory-sector-catalog.sql` confirma os nove itens, setor distinto de local, preservação de rótulo não padronizado e ausência de alterações no conjunto de ramificações. A cadeia PostgreSQL isolada executa esse fixture após as migrações.

A Etapa 16 permanece parcial: a identificação, seletor e Setor/Local agora cobrem Inventário, Gestão TI, Controle TI e Flux. Ainda falta auditoria de todos os demais módulos/tabelas futuras, validação visual de ponta a ponta e decisão humana sobre como distinguir setores físicos de ramificações classificatórias antes de qualquer consolidação. A cadeia local usa apenas dados fictícios; nada foi aplicado ao banco principal.
