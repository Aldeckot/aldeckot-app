# Home ALDECKOT — execução das sete etapas (2.1.55; ajustes visuais 2.1.56–2.1.57)

Data: 23/10/2026. Esta é a consolidação local do pacote `ALDECKOT_HOME_CODEX_7_ETAPAS_2026-10-23.zip`, lido na ordem das sete partes. O registro da entrega anterior 2.1.54 permanece em `HOME_REFORMULATION.md` como histórico, não como regra atual.

## Sequência e resultado

| Etapa | Escopo aplicado |
| --- | --- |
| 01 — Fundamentos, auditoria e visual | Aproveitados autenticação, RLS, consultas e sincronização existentes. Home em três áreas, vidro translúcido legível, wallpaper animado nos dois temas, menu sem moldura externa e cinco novas ilustrações transparentes. Animação cromática da marca restaurada sem mudar fonte/tamanho. |
| 02 — Resumo Global e Central de Operações | Resumo mantém consolidação de equipamentos por identidade persistente. Central agora é analítica: modos “Em andamento” e “Atividades no período”, gráfico circular interativo, filtros combináveis de módulo, tipo e período, e modal derivado do mesmo conjunto de linhas. A altura dos quadros centrais foi reduzida para não esticar cartões e gráfico. |
| 03 — Motor de alertas e Verificando | Alertas são calculados de registros de Inventário, Gestão TI, Controle TI, Flux, Fiscal, Suprimentos e efeitos de integração. Um caso reúne causas do mesmo acompanhamento e conserva a maior gravidade; modal expõe os motivos e o vínculo de origem. A migração 094 já aplicada pelo usuário é respeitada, sem criar tickets retroativos ou movimentações fictícias. |
| 04 — Painéis operacionais e busca | Recentes e alertas mostram três itens na prévia. O alerta se expande no espaço anteriormente ocupado por “Indicadores do mês”; o quadro mensal foi removido por decisão posterior do usuário, sem excluir seus cálculos. “Últimas atividades” também continua fora da Home, com dados preservados. Busca e links mantêm IDs da origem. |
| 05 — Identidade, análise, sincronização e segurança | Leituras usam Supabase e RLS existentes. Eventos, chamados, transferências e ocorrências fiscais mantêm IDs; filtro, total, fatias e lista usam uma única projeção. Falhas de fonte e histórico incompleto são mostrados como parcial/indisponível, nunca inventados como zero. Consulta histórica personalizada é somente leitura. |
| 06 — Testes, aceite e relatório | Testes de modelo, regras de tempo/gravidade, integração visual, navegação, filtros, modal e calendário; captura em 1920, 1600, 1366, 900 e 390 px nos dois temas. |
| 07 — Consolidação | Versão 2.1.55 sincronizada; arquivos antigos e trabalho preexistente preservados. Sem SQL novo, commit, push ou deploy nesta etapa. |

## Regras dos dados

A Central separa fatos ocorridos de processos ainda abertos, para não somar naturezas diferentes. “Atividades no período” usa cadastros com data comprovada, criação de chamados, eventos de conclusão de manutenção e verificação, transferências recebidas e ocorrências fiscais datadas. “Em andamento” usa acompanhamentos abertos do Controle TI e transferências em curso. O período de processos abertos se refere à abertura, e a interface informa que pendências antigas podem ficar fora do filtro. Os gráficos e a listagem mostram o mesmo conjunto filtrado, com navegação para o registro original.

O histórico habitual de eventos e Fiscal inclui o mês atual e o anterior. Ao solicitar um intervalo personalizado anterior, a Home faz leitura paginada e limitada dos fatos correspondentes; se não obtiver cobertura completa, indica parcialidade. Datas não comprovadas não entram em indicadores datados. Consultas acima do limite explícito falham visivelmente em vez de truncar resultados silenciosamente.

As faixas de gravidade atuais são:

- Investigação: círculo com lupa para origem temporal ou identidade sem evidência suficiente; não afirma que o prazo foi ultrapassado.
- Baixa: círculo informativo.
- Média: círculo de atenção. Manutenção física após 15 dias completos; acompanhamento sem atualização técnica após 7 dias completos.
- Alta: triângulo vermelho. Manutenção física após 30 dias completos; acompanhamento sem atualização técnica após 15 dias completos.
- Verificando conserva a regra técnica anterior de 48/72 horas, desde que a data de início seja comprovada. Não é contado como manutenção física.
- Defeito, estoque abaixo do mínimo, recorrência fiscal e falhas de integração usam estados persistidos. Nenhum alerta é criado por mera aparência da interface.

A última atualização técnica vem de logs técnicos elegíveis do Controle TI, não de `updated_at` genérico. Se faltar data confiável, o caso pede investigação. Múltiplos motivos do mesmo ticket são reunidos sem apagar a causa anterior.

## Decisões visuais posteriores ao ZIP

Os comentários mais recentes do usuário prevaleceram quando divergem do pacote: “Indicadores do mês”, “Últimas atividades” e “Abrir dia” foram retirados; “Alertas críticos” ocupa a altura livre; os botões “Ver todos” de recentes e “Ver detalhes” do mensal foram retirados; a coluna esquerda mantém todo o menu, apenas sem moldura. O calendário oferece criação de tarefa, evento ou post-it ao selecionar um dia, além de acesso aos registros daquele dia. Notificações ficam fora da área rolável do menu. O tema claro usa o wallpaper fornecido, e as distribuições de Status, Situação, Limpeza e Motivo mantêm tons mais vivos e legíveis.

As cinco artes novas foram geradas no recurso de imagem integrado, com fundo transparente, e reduzidas a 480×360: leitor/etiquetadora/tablet (Inventário), estação de trabalho diagnóstica (Gestão TI), ferramentas de reparo (Controle TI), caixas/carrinho/setas (Flux) e documento fiscal/comprovante (NF-e). Elas não substituem o logotipo oficial.

## Verificações locais

- Versão 2.1.55 sincronizada e incrementada.
- Sintaxe: 149 scripts e páginas essenciais aprovados.
- Migrações: 93 verificadas; nenhuma pendente após a 094 informada como aplicada pelo usuário.
- Unidade/contrato: 305 aprovados, zero falhas.
- Navegação/interface: 50 aprovados, zero falhas, incluindo os dois temas e cinco larguras.

Os dados fictícios usados pelos testes automatizados não foram inseridos no Supabase principal. A aplicação continua preparada para ler dados reais sob as permissões existentes, mas estes testes não equivalem à validação de uma primeira operação real em produção.

## Limites de aceite e publicação

Ainda dependem de observação no ambiente principal: perfis/RLS reais, latência com volume real, Realtime entre sessões e o primeiro ciclo real de entrada/conclusão em “Verificando” após a 094. Não alterar equipamentos de produção apenas para satisfazer teste. A migração 094 não reconcilia os quatro equipamentos que já estavam em “Verificando” antes de sua aplicação; não foram inventados tickets ou datas históricas.

O checkout continha mudanças preexistentes de outras origens e trabalho em andamento. Por isso não foi criado commit nem executado push/deploy. O relatório anterior contém o ponto de reversão criado para a reformulação inicial; restaurá-lo em bloco apagaria trabalho posterior e não deve ser feito automaticamente.

## Refinamento visual 2.1.56

O wallpaper passou a ficar nítido também fora da imagem central: foi retirado o desfoque do plano de fundo global, com ajuste moderado de brilho e contraste nos dois temas. O vidro translúcido e seu desfoque continuam dentro de cada painel da Home; os cards dos módulos não recebem esse filtro. A cobertura visual inclui agora a largura de 1267×724 usada nos comentários do navegador. Após o ajuste, 305 testes de código e 52 testes de interface passaram; versão, sintaxe e migrações foram verificadas novamente.

## Correção do plano de fundo 2.1.57

O comentário posterior esclareceu que a imagem não deve reaparecer dentro de um bloco central, nem parecer uma coleção de wallpapers por coluna. A Home usa agora só o plano global animado; a área antes chamada hero é apenas um espaçador transparente. Seções centrais e da direita não possuem borda, fundo próprio ou desfoque em forma de quadro. Linhas individuais de dados mantêm superfície suficiente para leitura. Os cards dos módulos voltaram a fundos quase opacos, com cores próprias e sem desfoque. O tema claro recebeu reforço de contraste nos títulos e legendas centrais.

## Equilíbrio de transparência 2.1.58

A transparência total dos painéis prejudicou a leitura sobre o wallpaper. Cada área funcional recebeu um sombreado radial mais opaco no centro e suavemente dissipado nas bordas, sem borda rígida, imagem duplicada ou desfoque retangular. Os cards dos módulos e a imagem global não foram alterados. A composição segue verificada nos temas escuro e claro, inclusive em 1267×724.

## Wallpaper e movimento 2.1.59

A Home recebeu um par novo de wallpapers, gerado com a arte anterior como referência: rede isométrica de servidores e equipamentos de TI, com o núcleo menor e mais espaço para os indicadores. Os arquivos anteriores foram preservados. O plano global agora percorre posições mais variadas, sem criar um fundo separado para cada seção. Os painéis têm cantos de 12 px sem moldura rígida; os dois gráficos receberam anéis decorativos em sentidos horário e anti-horário, sem girar os segmentos clicáveis. O calendário foi compactado e o gráfico de Operações ajustado para caber na altura de 724 px. A preferência por movimento reduzido desativa essas animações.

## Nova composição e reorganização 2.1.60

O usuário observou que o par anterior se parecia demais com a arte já existente. A nova versão substitui a composição por um centro de dados panorâmico claramente distinto, com fileiras de racks, bancada de equipamentos, conexões luminosas discretas e espaço inferior livre; há variantes escura e clara. Os rascunhos intermediários não utilizados foram descartados, enquanto os wallpapers anteriores permanecem preservados. Resumo Global e Central de Operações ganharam uma faixa inferior mais alta e sem rolagem interna em desktop; o botão Limpar foi integrado ao cabeçalho para liberar uma linha dos filtros. A altura de 1624×724 foi verificada com filtros padrão e intervalo personalizado.
