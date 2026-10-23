# ALDECKOT — reformulação da Home (2.1.54)

> Registro histórico da entrega 2.1.54. A especificação posterior em sete etapas e as decisões mais recentes da Home estão documentadas em [HOME_7_ETAPAS_EXECUCAO.md](HOME_7_ETAPAS_EXECUCAO.md); regras e números deste registro não descrevem necessariamente a versão atual.

## Situação da entrega — 23/10/2026

Implementação local e testes automatizados concluídos. Em 23/10/2026, o usuário informou ter aplicado a migração 094 no Supabase principal e enviou o resultado da consulta pós-aplicação. Não houve movimentação de equipamentos de teste em produção, push ou deploy. A aceitação funcional em produção continua pendente; a conferência de estrutura não substitui um fluxo real executado.

Foram recebidas e lidas integralmente as cinco partes, abrangendo as 35 seções. O documento termina em “FIM DA ESPECIFICAÇÃO”, sem truncamento. As cinco partes concatenadas têm 90.029 bytes e SHA-256:
`0fe793db086ba7935d57527d518b9769dd06d5121858a42e834c97d8cacf71e3`.

Ponto de reversão criado antes das alterações:
`C:/Users/ricardon/Documents/Codex/2026-08-27/se-x20/work/home-before-20261022/aldeckot-before-home.zip`.
SHA-256: `B5EE70C1B1F1F4E3CE21C308862588E4F606BB7E114E93909C3E5A28919E24E4`.
Preserva inclusive alterações locais anteriores; exclui Git, dependências, resultados de testes e arquivos .env. O ZIP da especificação também foi preservado nessa pasta.

## Auditoria e arquitetura aproveitada

| Área | Arquitetura existente e decisão |
| --- | --- |
| Entrada e versão | index.html, system-version.js e carregamento por versão; incrementados para 2.1.54. |
| Autenticação e permissões | AldeckotAuth/AldeckotSupabase e RLS; não criadas credenciais ou permissões novas. |
| Navegação | Páginas dos seis módulos e parâmetros table/item; abertura pelo ID do registro na origem. |
| Busca global | central-equipment.js; preserva homônimos e TAGs reutilizadas, sem unir identidades distintas na Home. |
| Agenda | agenda.js e serviço existente; preservados cadastro, edição, conclusão, lembretes, notas e arquivo. |
| Temas | Mecanismo compartilhado existente; novos wallpapers limitados à Home. |
| Inventário | inventory_items e IDs persistentes; consultas projetadas, sem fotos/históricos completos. |
| Gestão TI | module_records, management_computer_id e payload; posições vazias não são computadores. |
| Controle TI | control_items/control_item_logs, integração e conclusão de manutenção existentes. |
| Flux | flux_items; transferências em curso e recebimentos reais. |
| Fiscal | nfe_occurrences e consulta existente de recorrências por PDV. |
| Suprimentos | supply_stock_summary, supply_variants, supply_units e bibliotecas puras existentes; nenhuma criação de catálogo para renderizar a Home. |
| Eventos e integrações | equipment_events/equipment_event_effects; evidências reais e correlação por UUID. |
| Backups | Serviços existentes; somente backups automáticos confirmados entram em atividades. |
| Sincronização | Realtime compartilhado, atualização seletiva e consultas agrupadas; sem recarregar a página. |
| Histórico de PC/PDV | Movimento existente preservado; histórico técnico adicional usa UUID do computador e não acompanha a posição física. |

O painel antigo operational-dashboard.js foi mantido no repositório, mas não é mais carregado pela Home. Não houve reconstrução dos módulos internos.

## Interface e funcionamento

- Composição de três colunas no desktop: módulos e usuário; wallpaper/Resumo Global/Central de Operações; calendário/agendamentos/recentes/alertas/indicadores mensais.
- Seis módulos reais, com ilustrações já existentes otimizadas. Wallpapers claro e escuro são cópias WebP das imagens fornecidas; os originais não foram editados.
- Desktop sem rolagem global nas resoluções testadas; painéis com rolagem interna quando necessário. Tablet e celular reorganizam o conteúdo sem eliminar funcionalidades.
- Ícones SVG, rótulos retangulares, cores semânticas, estados de foco, fechamento por Escape e retorno de foco dos novos diálogos.
- Listagens com filtro e paginação de 25 registros. Contadores e detalhes usam o mesmo conjunto de dados.
- Busca Ctrl+K e navegação por identificadores persistentes; TAG ambígua continua apresentando opções distintas.
- Calendário permite selecionar dias, navegar entre meses, voltar para Hoje e abrir os registros da data em diálogo, sem o quadro lateral de eventos. Meses antigos são consultados separadamente: não ficam limitados ao período recente dos indicadores.
- Próximos agendamentos respeitam data/hora e conclusão. “Abrir dia” abre compromissos e categorias operacionais da data, preservando os formulários existentes.
- Atualizar refaz consultas; mudanças de dados não remontam o wallpaper nem reiniciam a página. O wallpaper da Home repete o movimento suave compartilhado do sistema, com redução de movimento respeitada.
- A moldura externa do menu foi removida; logo, busca, módulos e perfil permanecem. Recentes e alertas mostram até três registros por prévia; os itens permanecem acessíveis individualmente. Alertas conserva “Ver todos”.
- Pendências de identidade e datas são alertas individuais na fonte de “Alertas críticos”, sem criar fatos ou alterar registros; o quadro isolado de conferência foi removido.
- A Central de Operações mostra origem dos números nos cartões e diálogos. O estilo de rótulos com contorno foi compartilhado entre status, situação e limpeza dos módulos, mantendo as cores semânticas.
- As distribuições de Status, Situação, Limpeza e Motivo em Inventário, Controle TI, Flux e Gestão TI usam barras e legendas mais saturadas em ambos os temas; altura e contagem não foram modificadas.
- Sem CPU, RAM ou monitoramento em tempo real fictício. ALDECKOT Agent e patrimônio automático global não foram implementados.

A composição foi validada visualmente nos dois temas. As ilustrações dos módulos foram reaproveitadas, não são cópias pixel a pixel de cada objeto da referência. Foi fornecido wallpaper claro, mas não uma referência completa de layout claro; a aprovação visual final pelo usuário permanece necessária.

## Fontes e critérios dos indicadores

### Resumo Global

Consolida equipamentos físicos do Inventário com computadores efetivamente cadastrados na Gestão TI. Não soma chamados, transferências, posições vazias nem quantidades de Suprimentos como equipamentos adicionais.

A identidade é o UUID de origem. Correspondência entre módulos exige vínculo explícito ou série única confiável e identificação compatível. TAG isolada nunca determina fusão. Situações ambíguas permanecem separadas e geram aviso de conferência. Uma mesma identidade de PC ocupando várias posições gera conflito explícito, sem navegação arbitrária para um dos registros.

Status: Ativo verde; Reserva amarelo; Manutenção vermelho; Inativo cinza; Defeito laranja. Valores legados desconhecidos ficam em “Outros”, sem alterar o dado original. Percentuais usam o mesmo total consolidado.

### Central de Operações

Ativos vêm dos equipamentos consolidados; manutenção e chamados vêm dos registros operacionais do Controle TI; transferências em curso vêm do Flux; ocorrências fiscais vêm do Fiscal. Acompanhamento técnico de verificação não é contado como manutenção física.

Conclusões usam evento real de conclusão ou data de saída válida do chamado. Nunca se usa updated_at para presumir conclusão.

### Indicadores mensais

Usam o mês civil em America/Sao_Paulo. Novos equipamentos exigem data de cadastro conhecida; o cadastro de posição não é usado como data de criação do PC. Transferências concluídas usam recebimento; ocorrências usam occurred_at; manutenções usam conclusão efetiva.

Quando falta uma data histórica, o indicador é sinalizado como parcial (†) e há explicação. Sem base anterior positiva, não se inventa percentual nem se divide por zero.

### Alertas

Regras centralizadas em home-operational-model.js:
- Manutenção: atenção após 3 dias e prioridade alta após 7, a partir da entrada real.
- Verificando: prioridade média após 48 horas e alta após 72, com início comprovado.
- Chamado antigo: referência de 7 dias; integração pendente: 30 minutos.
- Estoque: saldo e mínimo reais por variação, com regras existentes do Suprimentos.
- Defeito e falhas de integração: estado persistido, sem criar incidentes fictícios.
- Recorrência fiscal: consulta já existente do módulo.

A mesma condição não gera alertas repetidos para equipamento e chamado. A regularização remove o alerta derivado, sem apagar o histórico de origem.

### Atividades e recentes

Os dados de atividades continuam contendo efeitos automáticos confirmados/falhos e backups automáticos persistidos, mas o quadro de atividades não é exibido na Home. Edição manual de equipamento não é apresentada como automação. “Últimos itens atualizados” é uma projeção dos registros atuais, com links para a origem.

## Consultas, falhas e desempenho

home-data.js faz leituras com projeções mínimas, paginação de 500, RLS e cache de último resultado válido. Não carrega fotos, backups completos ou payloads inteiros para os indicadores.

Uma fonte indisponível não vira zero. Se houver resultado anterior, ele é mantido e marcado como desatualizado. Sem resultado válido, o painel informa indisponibilidade. Falhas de um módulo não apagam dados válidos dos outros.

Há limite explícito de 50.000 linhas por consulta; ao ultrapassá-lo, a fonte informa erro em vez de truncar silenciosamente. O volume e a latência da produção ainda não foram medidos. Bases maiores poderão exigir agregações no servidor.

Realtime usa atualização seletiva com agrupamento de eventos. Há atualização ao retomar a aba após intervalo e consulta periódica somente quando visível. O calendário mantém cache limitado de meses, invalidado após atualização confirmada.

## Migração 094 aplicada pelo usuário

Arquivo: supabase/094_control_technical_verification.sql.
SHA-256: `87290c439aa9ccaf31a4edaea03487ad6853a6d1b16880a42f96e08c9f0a7283`.

O usuário executou o preflight no Supabase principal em 23/10/2026. Informou nove funções presentes e pertencentes a `postgres`, regra de status existente, zero divergências de identidade dos PCs, zero colunas novas e migração ainda ausente. Havia quatro equipamentos do Inventário já em `Verificando` e nenhum PC nessa situação.

Após aplicar a 094, o usuário enviou o postflight: função de conclusão e consulta de histórico técnico presentes; dez gatilhos habilitados; índice do histórico presente; execução autenticada permitida e anônima bloqueada; zero chamados técnicos novos, verificações abertas, duplicações ou eventos com alteração física. Estes resultados confirmam a instalação da estrutura no momento da consulta, não o comportamento de uma primeira operação real. Não reaplicar a 094.

A migração adiciona cinco campos em control_items: tipo de acompanhamento, origem Inventário, UUID do PC, início e conclusão da verificação. Acrescenta “Verificação concluída” ao estado técnico do Controle TI, índices de unicidade de verificações abertas, view privada para manutenção, funções, gatilhos e consulta de histórico técnico.

Novas entradas em Verificando:
- Reaproveitam manutenção aberta compatível, quando existente.
- Caso contrário, criam um acompanhamento técnico no Controle TI, não uma manutenção física.
- Não mudam status, localização, periféricos ou vínculos físicos só por estarem em verificação.
- Compartilham evento-raiz entre registros relacionados; usam travas e unicidade contra duplicação.
- Não reabrem chamados concluídos nem inventam episódios anteriores.

Conclusão técnica exige resultado e chave idempotente. Restaura a situação anterior apenas se o equipamento ainda estiver Verificando; mantém o status operacional e o local atuais. Quando há manutenção reaproveitada, a conclusão válida do fluxo existente resolve também a situação de verificação.

Com acompanhamento técnico próprio aberto, ativação/reserva do PC é bloqueada; mudança para Defeito/Manutenção exige concluir o diagnóstico técnico antes de iniciar esse outro fluxo. Isso impede chamados contraditórios simultâneos.

Histórico técnico do PC usa o UUID estável, sem escrever movimentos fictícios no PDV. Anotações manuais ficam rastreáveis; logs automáticos coordenados não são editáveis. Exclusões que eliminariam a identidade desse histórico são bloqueadas.

As funções legadas são preservadas e ajustadas incrementalmente para distinguir manutenção de verificação. A migração falha integralmente se detectar incompatibilidade. Não faz backfill de equipamentos que já estavam Verificando: não há data confiável para inventar um início.

## Arquivos modificados nesta entrega

- Novos: home-operational-model.js, home-data.js, home-operational.css, indicator-labels.css, distribution-vivid.css.
- Home: home.js, agenda.js, central-equipment.js, home-notifications.js, index.html.
- Integração: supabase-client.js, inventory.js e management.js.
- Banco/documentação: migração 094, consultas preflight/postflight, este relatório e supabase/README.md.
- Mídia: dois wallpapers e seis ilustrações de módulos em assets/home-*.webp.
- Versão/cache: package.json, package-lock.json, system-version.js e páginas HTML principais.
- Testes: home-data, home-operational-model, control-verification, home-recent-dedup; contratos de ícones/navegação; testes E2E da Home/Controle e integração PostgreSQL isolada.

O diretório já continha trabalho anterior; não houve limpeza, descarte de alterações ou publicação automática.

## Testes executados e evidências

| Validação | Resultado |
| --- | --- |
| check-version | Versão 2.1.54 sincronizada após a atualização documental. |
| check-project | Sintaxe de 147 scripts e páginas essenciais aprovada. |
| check-migrations --pending-after 094 | 93 arquivos válidos; 013 retirada/documentada; nenhuma pendência neste checkout após a aplicação da 094 informada pelo usuário. |
| node --test | 299 aprovados; zero falhas ou testes ignorados. |
| Playwright completo | 48 aprovados, com rotas externas bloqueadas e dados fictícios. |
| PostgreSQL/PGlite — 094 | Aprovado com owner_id e sem owner_id. |
| Regressão PostgreSQL/PGlite 086–093 | Aprovada: vínculos/localizações, aliases CPD/Matriz, tipos, reconciliação, rollback e idempotência. |
| Telas Home | 1920×1080, 1600×900, 1366×768, 900×900 e 390×844, nos temas claro/escuro. |

Os testes da 094 executam SQL de fato no banco isolado: início, reaproveitamento, conclusão, reenvio idempotente, novo episódio, bloqueios de diagnóstico/ativação/exclusão, histórico portátil, anotações e falha tardia com rollback. Conferem preservação de status, local e periféricos. Não representam um teste simultâneo com duas sessões reais de PostgreSQL.

Os testes de interface cobrem também proteção sem sessão, entrada de módulos, transferência/substituição, foto contida no quadro, moldura de TAG por situação, separação do histórico de PC/PDV e associação física dos periféricos.

Os testes novos da Home cobrem correspondência entre total e listagem, filtro, ambiguidades de TAG, atualização sem remontar wallpaper, falha parcial, calendário histórico e atividades automáticas. Os dados fictícios dos testes não são inseridos na aplicação real.

Neste ambiente npm não está disponível. As rotinas equivalentes foram executadas diretamente com Node; não se afirma que o comando npm run verify funcionou.

Capturas locais: test-results/home-<largura>-<tema>.png. São evidências de testes com dados fictícios, não prints da produção.

## Ajustes visuais e funcionais da 2.1.53

- O painel da Central de Notificações é montado fora da área rolável do menu; o sino permanece no menu. O painel oculto não intercepta cliques e mantém abertura, fechamento por Escape e rolagem própria em telas amplas e estreitas.
- A moldura externa do menu foi removida sem retirar logo, busca, cartões dos módulos ou perfil. A rolagem do menu permanece possível sem barra aparente.
- Os cartões e quadros da Home receberam transparência e desfoque mais fortes. Linhas do tema claro e diálogos conservam superfícies de contraste para leitura.
- O resumo circular ganhou um brilho orbital discreto, desativado quando o usuário prefere movimento reduzido. As barras visíveis de Alertas críticos e Indicadores do mês foram ocultadas sem desativar a rolagem.
- A regressão da interface cobre painel aberto, posicionamento fora do menu, tela móvel, ausência de moldura e animação do resumo. Foram aprovados 48 testes E2E e 299 testes de unidade; verificação de versão, projeto e migrações sem pendências após 094.

## Ajustes da Home na 2.1.54

- O quadro “Últimas atividades do sistema” foi retirado da Home. Seus registros, consultas e histórico de origem não foram apagados.
- Resumo Global e Central de Operações foram ampliados e ocupam juntos a faixa inferior antes usada pelas atividades. O resumo foi centralizado verticalmente; os indicadores da Central mantêm origem legível.
- Os botões “Ver todos” de Últimos itens atualizados e “Ver detalhes” de Indicadores do mês foram removidos. As linhas recentes e os cartões mensais continuam clicáveis; os botões de outros painéis não foram alterados.
- Testes de composição em cinco larguras e nos dois temas conferem ausência do quadro, preenchimento da área, dados preservados e ausência dos dois botões.

## Pendências e limites de aceite

1. A estrutura da 094 foi conferida pelo postflight enviado pelo usuário. Ainda falta validar a primeira entrada e conclusão reais de `Verificando`; zero eventos novos haviam ocorrido quando o relatório foi executado. Não gerar uma movimentação fictícia em produção apenas para testar.
2. Validar dados, RLS de perfis reais, Realtime, latência e integração no Supabase principal. Nenhum teste de movimentação foi feito nos equipamentos reais.
3. Aprovação visual pelo usuário, principalmente do tema claro, cuja referência completa não foi fornecida.
4. Restauração legada do Controle TI: criação, consulta e download de backups continuam disponíveis. A restauração que apagaria/recriaria IDs é bloqueada se houver acompanhamentos técnicos no destino ou no backup. Uma restauração segura desses casos depende de rotina própria que preserve identidades; não foi implementada nesta entrega.
5. Quatro itens do Inventário já estavam em `Verificando` antes da 094. A migração não criou chamados retroativos para eles. Datas legadas sem início/conclusão/cadastro comprovados permanecem parciais; não foram alterados status apenas para completar indicadores.
6. Retenção existente de backups/efeitos limita o histórico automático disponível. Não há reconstrução de eventos ausentes.
7. Disputa simultânea real entre dois usuários e ensaio de carga em PostgreSQL remoto permanecem não executados. Travas, índices e reenvio foram validados localmente.
8. Pendências anteriores de mapeamento de monitores fora dos PDVs não foram reinterpretadas nem alteradas pela reformulação da Home.

## Reversão e segurança

O ZIP permite recuperar os arquivos anteriores, com seleção cuidadosa para preservar qualquer trabalho posterior. Não substituir indiscriminadamente um diretório sujo.

Após a 094, não apagar colunas, chamados ou históricos para reverter aparência. A versão anterior do Controle TI não compreende o novo subtipo: eventual reversão precisa preservar o cliente compatível e as estruturas técnicas ou ser planejada especificamente.

Não foram incluídas credenciais no relatório. Nenhuma migração destrutiva, publicação, instalação do Agent ou mudança automática de equipamento para preencher a Home foi realizada.
