# Controle TI — Etapa 7: pendências e próximas ações

## Entregue localmente

- Tarefas vinculadas ao UUID de um chamado, com descrição, criação, prazo opcional, prioridade, situação, observações e texto de conclusão. Alterações incrementam a revisão e geram um evento imutável com os valores anteriores e novos.
- A aba Pendências permite criar e atualizar tarefas. A Visão Geral mostra a próxima tarefa aberta; a Central apresenta a quantidade e a lista das vencidas, sem repetir a mesma tarefa como alerta duplicado.
- A conclusão de uma tarefa exige texto explicativo; uma tarefa sem prazo não é classificada como vencida. Pendências abertas continuam editáveis depois do encerramento do chamado.
- Antes de concluir um chamado Resolvido, a interface lista as pendências abertas e solicita a decisão explícita de mantê-las abertas. A RPC compara a lista atual com a lista revisada; qualquer mudança entre leitura e confirmação bloqueia a operação. Um gatilho também barra transições legadas que tentem concluir com pendências sem decisão.
- A confirmação não conclui ou cancela tarefas automaticamente e não altera o status ou a localização física do equipamento.

## Limites intencionais

A Central apresenta alertas de pendências vencidas; a integração com o painel global de alertas pertence à Etapa 9. Não foram criados responsáveis novos, componentes, peças ou custos. A migração 100, assim como 095–099, **não foi aplicada ao Supabase de produção**. Antes de qualquer implantação real, é necessária avaliação específica, backup e validação controlada das reconciliações históricas.

## Validação

Em 24/10/2026, a migração 100 e a cadeia precedente foram aplicadas em PostgreSQL local efêmero, sem portas ou rede, usando exclusivamente dados fictícios e rollback dos cenários. Os testes verificam vencimento, histórico imutável, revisão concorrente, reenvio idempotente, permissão, rejeição de encerramento sem decisão ou com lista desatualizada, preservação de tarefas abertas e atualização após o encerramento. Os testes de navegador cobrem criação, conclusão, consentimento explícito, ausência da migração e alerta único na Central.
