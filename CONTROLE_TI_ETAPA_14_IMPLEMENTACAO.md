# Controle TI — Etapa 14: interface, desempenho e regressão

## Resultado da revisão

A Central já reutiliza a identidade visual dark/light do ALDECKOT, componentes de vidro legíveis, estados acessíveis, filtros server-side, busca por equipamento/TAG/série e paginação configurável 10/25/50/100 (25 por padrão). O detalhe do chamado é modal e mantém o contexto da tela. Os relatórios da Etapa 12 também têm filtros server-side, tabelas roláveis e grids responsivos.

Para não duplicar uma segunda interface, esta etapa acrescenta regressões de ponta a ponta para filtros de relatórios, separação entre chamados e intervenções e viewport móvel. A porta do servidor de teste agora pode ser definida com `ALDECKOT_E2E_PORT`, evitando colisão com a prévia local aberta pelo usuário. Não foi necessária migração de banco.

## Verificação

- Suíte Node: 342 testes passaram.
- Verificadores de versão, sintaxe e sequência: passaram; 105 migrações reconhecidas.
- PostgreSQL efêmero, sem rede: migrações até 106 e cenários fictícios passaram na execução da Etapa 12.
- A execução Playwright dos novos cenários foi tentada em porta isolada, mas não terminou durante a janela de validação e foi interrompida. Portanto, esses novos cenários E2E estão adicionados, mas não são declarados como aprovados.
- `npm run verify` não pôde ser invocado porque `npm` não está no PATH deste ambiente; seus verificadores equivalentes via Node foram executados diretamente.

Nenhuma alteração de produção ou push foi realizado. Veja [`e2e/control-operational.spec.mjs`](e2e/control-operational.spec.mjs) e [`playwright.config.mjs`](playwright.config.mjs).
