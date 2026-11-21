# Controle TI — Etapa 5: detalhe do chamado

## Entregue localmente

- Modal da ocorrência com sete abas: Visão Geral, Diagnóstico, Intervenções, Pendências, Componentes, Movimentações e Histórico.
- Consulta por UUID da ocorrência, inclusive quando o equipamento existe somente na Gestão TI. O Inventário não é exigido nem criado por inferência.
- Diagnóstico em revisões imutáveis: sintoma, hipótese, testes, resultados, causa e diagnóstico final. Uma nova revisão preserva todas as anteriores; a gravação exige permissão, operação única e chamado não encerrado.
- Histórico auditável das mudanças de estado e revisões da mesma ocorrência. Notas antigas do cadastro aparecem separadas, identificadas como possivelmente referentes a outros episódios.
- Movimentações limitadas a eventos físicos oficiais vinculados à identidade estável, dentro do período do chamado. Uma mudança de estado técnico não aparece como deslocamento.
- Fallback para o detalhe legado quando a migração 098 ainda não está disponível no servidor.

## Limites intencionais

Intervenções, pendências e componentes ainda não têm registros formais; suas abas informam isso até as Etapas 6–8. A próxima ação não é presumida antes da Etapa 7. O local físico da Gestão TI aparece somente quando a identidade estável permite encontrá-lo; origem ambígua permanece sem local atribuído. A migração não inventa diagnósticos históricos.

## Validação e implantação

Em 24/10/2026, a migração 098 e os testes de revisão, idempotência, permissão e equipamento sem Inventário passaram em PostgreSQL local efêmero, com dados fictícios e rollback. Passaram também 323 testes unitários e 70 testes de interface, além das verificações de versão e sequência de migrações. **Nenhum dado de produção foi alterado.** As migrações 095–098 dependem de avaliação e aplicação controlada antes de ativar o novo fluxo no Supabase principal.
