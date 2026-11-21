# Controle TI — Etapa 6: intervenções e cronologia

## Entregue localmente

- Registro de múltiplas intervenções independentes por chamado, com data e hora, tipo, descrição e resultado obrigatórios. Responsável técnico e referência são opcionais; não é criada uma conta de usuário para preenchê-los.
- Cronologia da própria ocorrência, em ordem de execução, também integrada ao histórico. O estado exibido é uma fotografia do momento do registro, não uma reconstrução automática de uma data anterior.
- Operação idempotente com UUID, permissão por tabela, conta ativa e bloqueio de novas intervenções em chamado encerrado. A leitura é restrita a contas ativas; não há edição ou exclusão direta dos registros.
- Central Operacional mostra as seis intervenções mais recentes e abre o chamado correto. Se a migração 099 não estiver instalada, apresenta indisponibilidade explícita sem simular dados.
- Formulário adaptado a telas estreitas, com confirmação no próprio modal após salvar.

## Limites intencionais

Registrar uma intervenção não muda o estado do chamado, não abre novo episódio, não altera o status físico do equipamento e não cria movimentação no Inventário ou Flux. Pendências, peças/componentes e custos continuam para etapas posteriores. O banco de produção não recebeu a migração 099 nem as migrações 095–098 por esta implementação; qualquer aplicação real exige avaliação própria, cópia de segurança e validação controlada.

## Validação

Em 24/10/2026, a cadeia até a migração 099 foi exercitada em PostgreSQL local efêmero, isolado de rede, com dados fictícios. O cenário registra cinco intervenções em dias distintos no mesmo chamado e verifica cronologia, reenvio idempotente, permissão, rejeição de data futura e de chamado encerrado, ausência de transição de estado e proibição de atualização direta. Os testes de interface cobrem gravações sucessivas, histórico, fallback sem a 099, navegação da Central e layout móvel. Consulte `tests/sql/run-local-migrations.ps1`, `tests/sql/control-case-integration.sql`, `e2e/control-verification.spec.mjs` e `e2e/control-operational.spec.mjs`.
