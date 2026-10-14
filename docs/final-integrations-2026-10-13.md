# Melhorias finais — implantação segura

As alterações de interface da versão 2.0.107 dependem das migrações 074 a 078, nesta ordem. Nenhuma delas reconcilia dados antigos por TAG ou cria relações de compatibilidade por semelhança de nomes. A migração 074 acrescenta apenas relações explícitas por modelo; a 075 acrescenta recibos de revisão e funções transacionais; a 076 admite o status auditável `Cancelado` e protege históricos estornados. As migrações 077 e 078 corrigem, respectivamente, a referência ambígua ao ID de evento no gatilho patrimonial e a coluna da tabela de origem consultada no estorno.

## Estado da implantação — 14/10/2026

As migrações 074, 075 e 076 foram aplicadas, nessa ordem, ao projeto de produção `rwehxhrxomyserxvwymf` pelo SQL Editor. A 073 já estava presente. Após cada execução, uma consulta independente confirmou as tabelas, funções, políticas ou gatilhos esperados. Antes da 076, os status reais e a restrição anterior do Controle TI foram conferidos; todos os valores existentes permanecem permitidos. Não houve backfill nem criação de relações ou movimentações de teste.

As migrações 077 e 078 foram aplicadas em 13/10/2026, uma por vez, após testes em transações revertidas e autorização explícita. Depois de cada aplicação, uma consulta independente confirmou a definição instalada da função. Os fluxos completos de Inventário e Gestão TI foram repetidos em produção com as funções definitivas, sem patches temporários: prévia, confirmação, status, chamado, evento compartilhado, estorno e idempotência passaram. Também passaram os bloqueios para prévia desatualizada e histórico posterior e a relação explícita de compatibilidade por modelo em Suprimentos. Cada cenário terminou com `rollback`; consultas finais retornaram zero registros fictícios.

Passaram `check:version`, `check:project`, `check:migrations`, os 172 testes Node e a verificação de leitura anônima das 16 tabelas protegidas, incluindo as duas novas. Uma auditoria de leitura encontrou zero vínculos órfãos de Flux e Controle TI para Inventário e Gestão TI. Na prévia local, o modal do Flux exibiu dados reais de Gestão TI e foi cancelado; também foram conferidos um item de Inventário e um próprio de Suprimentos, a regra por categoria e o formulário de modelo.

O painel de backups do projeto informa que o plano Free não inclui backups programados; portanto, não há backup recuperável da plataforma confirmado para a aplicação. Os testes transacionais não foram executados sobre equipamentos operacionais nem deixaram dados persistidos. Um ensaio com registros reais designados continua opcional e deve ser planejado separadamente, sem inferir que os testes revertidos equivalem a uma operação persistida de ponta a ponta.

## Procedimento para outra instalação

1. Faça um backup recuperável do Supabase e confirme que as migrações até 073 estão ativas.
2. Confira permissões de administradores e os gatilhos das migrações 072 e 073. Não use `service_role` no navegador.
3. Aplique os arquivos 074 a 078, nesta ordem, no SQL Editor do projeto correto. Cada arquivo usa uma transação; se houver erro, pare, registre a mensagem e não execute a próxima migração.
4. Depois de cada aplicação, atualize a prévia local. A aba de compatibilidade deixa de mostrar “migração 074” quando a primeira migração estiver ativa. A confirmação de Flux permanece bloqueada, sem gravação, enquanto a função da 075 não existir.

## Validação funcional após a aplicação

Use registros de teste designados e verificáveis, não equipamentos operacionais. Para a confirmação, abra o formulário do Flux, confira a prévia e cancele: não deve surgir movimento, log ou chamado. Depois confirme um envio para manutenção com vínculo UUID de Inventário e outro de Gestão TI. Compare movimento, status, chamado e IDs de evento. Verifique também resposta a repetição do mesmo identificador de solicitação e a alteração de status entre prévia e confirmação.

Para o estorno, use somente uma movimentação nova elegível e um chamado criado nessa mesma operação. Confira restauração do status anterior, chamado `Cancelado`, logs preservados e evento ligado ao original. Depois verifique o bloqueio da segunda solicitação e de um caso com edição ou movimentação posterior. Movimentações antigas ou com chamado preexistente não são estornadas automaticamente.

Cadastre uma relação de compatibilidade com marca e modelo reais em um suprimento próprio e consulte-a novamente. Verifique que nenhuma quantidade, TAG ou status mudou. Compare no painel um item próprio e um importado do Inventário: categoria é classificação; origem é o módulo responsável. Altere o status de uma unidade de teste na fonte Inventário e confirme a atualização dos indicadores de Suprimentos.

## Limites e recuperação

Os testes automatizados locais verificam sintaxe JavaScript, contratos de migração e regras puras; não executam SQL no Supabase. Os cenários SQL em produção acima foram executados separadamente, dentro de transações revertidas. Não use `scripts/verify-supabase.mjs` como teste inocente: ele cria e remove registros temporários. Se uma migração falhar, sua transação deve ser revertida integralmente; corrija o arquivo e repita apenas depois de analisar o erro. Após um estorno real, não reverta a migração 076 nem apague o recibo: o vínculo histórico deve permanecer.
