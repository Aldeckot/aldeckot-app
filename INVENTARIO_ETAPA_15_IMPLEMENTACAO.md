# Etapa 15 — Substituição no Inventário

## Implementação

- O botão **Substituir** aparece junto ao campo Modelo nos detalhes de um equipamento ativo do Inventário.
- O seletor lista reservas da tabela inteira, independentemente do setor ou da ramificação selecionados na navegação, e exibe TAG, série, modelo, setor, local e status.
- Uma comparação lado a lado mostra os dados dos equipamentos antes da confirmação. Condição final do retirado, destino e motivo são obrigatórios.
- A troca continua limitada à mesma tabela. O substituto recebe o setor e o local do equipamento retirado; o retirado recebe a condição final e o destino informados.
- TAG, série, UUID e vínculos de ramificação não são copiados. A trilha registra os setores anterior e final, e ambos os históricos recebem seus eventos.
- A migração `107_inventory_replacement_sector_transfer.sql` preserva atomicidade e atualiza a implementação do RPC existente.

## Validação

O fixture `tests/sql/inventory-replacement-cross-sector.sql` verifica uma troca fictícia de “Escritório” para “Frente de Loja” e injeta uma falha na atualização do substituto para confirmar o rollback das duas unidades, da trilha e dos históricos. Ele é executado pela cadeia local `tests/sql/run-local-migrations.ps1`, que usa PostgreSQL isolado, sem rede e com dados fictícios. Não houve conexão nem escrita no banco Supabase principal.

Os testes estáticos de contrato estão em `tests/inventory-replacement.test.mjs`. Playwright continua pendente de uma execução concluída.
