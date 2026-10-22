# Relação de monitores e aliases de local — 2.1.48

Atualização posterior, versão 2.1.49: o usuário localizou AJMON019 sob a TAG
MON0. Há quatro referências ao mesmo cadastro no ESTOQUE 01, não falta um
equipamento. A correção pontual está preparada em
[MON0_AJMON019_REPAIR.md](MON0_AJMON019_REPAIR.md), ainda não executada em produção.
O usuário também informou editar o local do AJMON024 para RH pela interface;
a persistência dessa alteração ainda não foi confirmada.

## Atualização da conferência — 22/10/2026

O relatório recebido, emitido às 11:19:47 UTC (08:19:47 de Brasília), confirmou
a regra CPD/Matriz e a função de normalização presentes, nenhum conflito
de local sem associação e AJMON020/021 vinculados a ESTOQUE 02/03.
**Não reaplicar a 093.** O trecho de preparação abaixo é histórico.

Dos 26 monitores esperados, 21 estão coerentes com a relação e as regras:
001–014, 015/016/026 sem associação, 020/021 nos Estoques, 023 na posição
do PC CONFERÊNCIA e 025 no CFTV. ESTOQUE 02/03 continuam sem PC cadastrado.

Diferenças restantes:
- AJMON017/018: monitores existentes, mas sem computador correspondente encontrado.
- AJMON019: nenhum registro encontrado com essa TAG; não prova que o
  equipamento não exista sob uma identificação antiga. Não duplicar por suposição.
- AJMON022: TESOURARIA ainda precisa ser distinguida de TESOURARIA 01/02.
- AJMON024: Inventário e vínculo estão no AUDITÓRIO; o destino autorizado é RH.

### Correção pontual do RH

Preparado [aldeckot-ajmon024-rh-correction.sql](aldeckot-ajmon024-rh-correction.sql).
Não é nova migração estrutural. Corrige apenas o monitor identificado por ID
e TAG, usando os gatilhos existentes para sincronizar Inventário/Gestão TI.
Preserva status, série, outros periféricos e históricos dos computadores.
Cria um registro explícito de correção cadastral no histórico do monitor,
sem inventar uma movimentação física retroativa.

O script valida identidade, local, status, vínculo de origem e PC de destino.
Se o RH já tiver entrada de monitor, houver duplicidade ou o estado mudar,
ele cancela toda a transação. Reenvio de uma correção concluída não duplica logs.

Testado em banco isolado: sucesso, rollback por falha de histórico, bloqueio
por mudança do PC de destino, preservação dos demais dados e idempotência.
Também foram executadas as verificações Node equivalentes aos scripts verify
e check:migrations (npm indisponível no ambiente).

**A correção do RH não foi executada na base principal.** Após executá-la,
repetir a auditoria dos 26 monitores abaixo: AJMON024 deve ter Local RH e
um único vínculo no RH, PC AJ RH, TAG AJPCRH01. Não reaplicar 089–093.

## Regras confirmadas pelo usuário

- AJMON001 a AJMON014 pertencem aos PDVs 01 a 14, independentemente do PC instalado.
- Sala CPD = Matriz para a regra de ausência de associação, em qualquer equipamento.
  Não há renomeação de registros nem mudança automática de status.
- ESTOQUE02/03 podem ser escritos com ou sem espaço.
- Os vínculos pertencem à posição física, nunca seguem o computador após transferência.
- Há autorização para corrigir cadastros conforme a relação enviada, preservando os dados.

## O que ficou pronto localmente

[093_inventory_installation_location_aliases.sql](../supabase/093_inventory_installation_location_aliases.sql)
é incremental após a 092, cuja instalação foi confirmada pelo relatório recebido
em 22/10/2026. A 092 aplicada não foi modificada.

A 093:
1. Amplia a regra sem associação para Matriz.
2. Normaliza a comparação dos nomes ESTOQUE com ou sem espaço. Não remove zeros.
3. Preserva a posição já vinculada quando apenas a grafia do local muda.
4. Reconcilia somente AJMON020/021 com ESTOQUE 02/03, sem mudar o local
   armazenado, status, identidade, computador ou histórico de PC.
5. Registra cada nova associação como correção cadastral, não como movimento
   físico retroativo. A repetição não duplica logs.
6. Cancela toda a transação se houver conflito em Matriz/CPD, monitor ausente
   ou duplicado, destino inexistente/ambíguo ou vínculo em outra posição.

Nenhum cadastro de PC, TAG, série ou terminal foi inventado. Não houve push/deploy.
O acesso ao navegador automatizado expirou; não foi possível executar alterações
na interface autenticada. A 093 NÃO foi aplicada por este trabalho.

## Conferência completa da relação

Use [aldeckot-093-monitor-relation-audit.sql](aldeckot-093-monitor-relation-audit.sql)
no SQL Editor. É somente leitura, mostra os 26 monitores esperados, o cadastro
encontrado, os vínculos e os PCs atualmente instalados. Funciona antes/depois
da 093, com a 092 instalada.

Não reaplicar 089–092. Aplique a 093 completa apenas na base em que a 092
já está instalada; ela contém validações transacionais de dados atuais.
Após a aplicação, repita a consulta acima para conferir os vínculos.

## Pendências que não foram resolvidas por suposição

- AJMON017/018: AJPCINFO01/02 não aparecem entre os PCs/terminais auditados.
  O nome da planilha não informa todos os dados do PC nem prova outro cadastro
  inexistente; não criar computadores duplicados.
- AJMON019 consta na relação, mas não na lista anterior de 25 monitores.
  A consulta completa verifica sua existência, sem criar um registro substituto.
- AJMON022: TESOURARIA pode representar 01 ou 02; o PC CONFERÊNCIA ocupa 02
  e a planilha já atribui AJMON023 a CONFERÊNCIA.
- AJMON024: a relação informa RH, enquanto a informação anterior indicava
  AUDITÓRIO. A consulta completa exibe o vínculo atual antes da correção.
- ESTOQUE 02/03 são posições válidas, porém estavam sem PC na auditoria recebida.
  Associar os monitores à posição não significa cadastrar um PC.

## Testes locais

A integração SQL em banco descartável passou: nove tipos de equipamentos em
Matriz, retirada sem mudar status, bloqueio de vínculo manual, variações de
espaço, preservação da posição, reconciliação, repetição sem duplicação e rollback
por conflito ou ambiguidade. O teste também confirma que a instalação não altera
os itens do Inventário nem os dados/históricos dos PCs.

O esquema sintético não é um clone integral de produção. Não foram realizados
testes de movimentação na base real. Consulte também CPD_ASSIGNMENT_092.md para
o histórico dos testes anteriores.
