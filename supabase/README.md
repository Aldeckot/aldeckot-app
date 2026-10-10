# Migrações e segurança do banco

Esta pasta contém as migrações SQL do Supabase em ordem numérica. Elas compõem o histórico do banco do ALDECKOT.

## Aplicação

1. Faça uma cópia de segurança antes de qualquer alteração estrutural.
2. Execute apenas as migrações que ainda não existem no ambiente, em ordem crescente.
3. Registre a versão aplicada e valide o sistema depois da execução.
4. Nunca altere uma migração que já tenha sido executada em produção. Para uma correção, crie a próxima migração disponível.

O número `013` foi retirado antes da publicação e, por isso, não representa uma migração ausente. A verificação automática reconhece essa numeração como histórica.

As migrações `028_agenda_task_completion.sql` e `029_agenda_event_completion.sql` adicionam o estado de conclusão para tarefas e eventos exibidos na tela inicial. Execute as duas, em ordem, antes de publicar a interface com as caixas de conclusão.

A migração `030_monthly_audit_reports.sql` cria o arquivo privado de PDFs da Auditoria mensal. Ela permite que administradores consolidem tarefas e eventos concluídos, atualizações dos módulos e armazenem os relatórios por mês no bucket `audit-reports`.

A migração `038_inventory_management_peripheral_sync.sql` conecta Inventário e Gestão TI: quando a TAG compatível de um equipamento tem o Local igual ao nome de um computador instalado, o periférico correspondente recebe essa TAG automaticamente. Execute-a depois da `037_identity_update_validation.sql`.

A migração `039_fix_inventory_management_peripheral_sync_owner.sql` corrige a sincronização na base corporativa centralizada, que não possui o campo `owner_id` nos itens. Ela resolve o erro `record "new" has no field "owner_id"` ao cadastrar equipamentos. Execute-a após a `038` antes de voltar a cadastrar ou editar itens do Inventário.

A migração `040_reconcile_inventory_management_peripherals.sql` restaura o formato dos periféricos e sincroniza também os itens que já estavam cadastrados no Inventário. Execute-a após a `039`; o resultado exibirá quantos periféricos foram atualizados.

A migração `041_management_control_maintenance_sync.sql` conecta Gestão TI e Controle TI: todo terminal com **Status** de Manutenção/Defeito ou **Situação** Em Manutenção é incluído automaticamente na última tabela criada do Controle TI. Ela também reconcilia os terminais já marcados, sem duplicar equipamentos, e mantém status e histórico compartilhados entre os módulos.

A migração `042_fix_management_control_maintenance_owner.sql` corrige a inclusão automática quando a reconciliação é executada pelo SQL Editor em instalações que usam `owner_id`: ela atribui ao registro o proprietário do PC e da tabela de destino, em vez de depender da sessão do navegador. Na base corporativa centralizada, onde esse campo não existe, ela termina sem alterações para que a `043` assuma a sincronização compatível.

A migração `043_fix_central_management_control_maintenance_sync.sql` é a correção para a base corporativa centralizada, onde os registros não possuem `owner_id`. Execute-a após a `042`; ela detecta automaticamente instalações que ainda exigem proprietário em itens e logs, sem depender desse campo nos registros de Gestão TI.

A migração `044_route_management_maintenance_to_current_month.sql` direciona as manutenções automáticas para a tabela nomeada com o mês e ano atuais — por exemplo, `SETEMBRO 2026`. Ela também move para o mês atual os itens automáticos que haviam sido vinculados a uma tabela anterior. Execute-a após a `043`.

A migração `045_agenda_postit_notes.sql` cria as notas Post-it vinculadas à Agenda. Ela adiciona checklist, nível visual, limite transacional de nove notas por conta em instalações privadas ou por operação na base centralizada, e preserva as notas até sua remoção manual. Execute-a após a `044` antes de criar a primeira Nota na Home.

A migração `046_limit_agenda_postit_notes_to_four.sql` atualiza o limite transacional para **quatro** Post-its, mantendo a disposição visual de três notas na primeira linha e uma na segunda. Execute-a após a `045` antes de criar uma nova nota.

A migração `047_postit_free_layout_and_ten_limit.sql` permite arrastar livremente até **dez** Post-its ativos, inclusive sobrepostos, e salva suas posições e tamanhos. Ela bloqueia o conteúdo depois da criação, mantendo disponível apenas a conclusão das tarefas e o ajuste visual pelo adesivo superior. Ao concluir todas as tarefas, a nota sai da Home e permanece no histórico, onde pode ser aberta em visualização ampliada, restaurada ou excluída individualmente. Execute-a após a `045`; ela substitui a regra de quatro notas da `046` quando essa migração já tiver sido aplicada.

A migração `048_allow_agenda_postit_editing.sql` permite editar uma Nota Post-it ativa por meio de duplo clique no ícone do seu nível. Ela mantém protegida a conversão da nota para outro tipo de agendamento. Execute-a após a `047` antes de usar a edição de Post-its.

A migração `049_fix_management_terminal_transfer_identity.sql` corrige a transferência entre terminais fixos da Gestão TI quando há TAG ou número de série nos computadores. Ela preserva a validação contra duplicidades nas edições comuns e libera somente a troca atômica já autorizada. Execute-a após a `048` antes de transferir computadores entre terminais.

A migração `050_defer_management_transfer_sync.sql` evita o erro `stack depth limit exceeded` durante a transferência. Ela adia a sincronização automática com o Controle TI até que os dois terminais estejam com suas identidades finais, impedindo uma recursão entre gatilhos. Execute-a após a `049`.

A migração `051_nfe_financial_values.sql` adiciona os campos **Valor total** e **Valor pendente** às NF-e. Ela impede valores negativos e valores pendentes superiores ao total, sem preencher artificialmente os registros antigos. Execute-a após a `050` antes de cadastrar novas NF-e com os valores financeiros.

A migração `052_nfe_management_inventory_logs.sql` sincroniza cada **nova NF-e** com o PC da Gestão TI cujo nome corresponde ao campo **PDV**. O histórico do PC recebe motivo, operador, fiscal e valores financeiros em linhas separadas. Para o motivo **Erro no cartão**, a migração também encontra o Pin Pad vinculado ao PC, pelo campo de periféricos, e cria no Inventário um registro com motivo, operador, número do cupom e PDV. Execute-a após a `051` antes de usar essa automação.

A migração `053_nfe_pin_pad_reason_sync.sql` amplia o registro automático do Pin Pad também para o motivo **Erro no Pin Pad**, mantendo o mesmo contexto de operador, cupom e PDV. Execute-a após a `052`.

A migração `054_module_backup_frequencies.sql` permite definir de forma independente, de **1 a 90 dias**, a frequência dos backups automáticos de Inventário, Gestão TI, Controle TI e Flux. O Fiscal NF-e já possui a mesma configuração. Uma alteração em um módulo não modifica os demais. Execute-a após a `053` antes de alterar as frequências nas telas de backup.

A migração `055_management_res_03_terminal.sql` acrescenta o terminal fixo **RES 03** ao setor **Frente de Loja** da Gestão TI, sem substituir ou alterar os terminais e computadores existentes. Ela não cria uma duplicata se o terminal já estiver cadastrado. Execute-a após a `054`.

A migração `056_management_shared_office_stock_transfers.sql` acrescenta **RES GERAL 01** e **RES GERAL 02** ao **Escritório**, e **RES GERAL 03** ao **Estoque**. Ela libera transferências de computadores entre esses dois setores, mantendo as transferências da **Frente de Loja** restritas ao próprio setor. Os terminais existentes e os dados técnicos dos computadores permanecem preservados. Execute-a após a `055`.

A migração `057_inventory_control_maintenance_sync.sql` cria ou atualiza um registro no **Controle TI** quando um item do **Inventário** entra em **Manutenção**, usando a tabela do mês atual. Ela vincula os itens por ID, reutiliza registros já identificados por TAG ou número de série e mantém a volta do status e dos logs mesmo quando esses identificadores estão vazios. Não reconcilia retroativamente itens já em manutenção. A tabela mensal do Controle TI precisa existir; se faltar, a mudança de status é recusada com uma mensagem explicativa. Execute-a após a `056`.

A migração `058_supplies.sql` cria o módulo **Suprimentos** sem dados de exemplo. Ela separa o saldo do item principal, o status de cada unidade rastreável e o status da ordem no Controle TI. Instalações apontam diretamente para o ID do Inventário ou da Gestão TI; abertura e conclusão de manutenção são operações transacionais com histórico. O bucket `supply-images` é privado, com limite de 5 MB. Execute-a após a `057`; a página `supplies.html` exibirá um aviso até a estrutura estar disponível. Antes de aplicá-la em produção, valide a execução em uma base de teste e confirme os vínculos existentes.

A migração `059_supply_backups.sql` adiciona backups privados e a frequência automática própria de **Suprimentos**, sem alterar os registros existentes. O arquivo JSON cobre as sete tabelas do módulo, mas armazena somente os caminhos das imagens, não os arquivos binários. A restauração automática permanece indisponível para preservar vínculos com Inventário, Gestão TI e Controle TI.

A migração `060_inventory_replacements.sql` vincula metadados de catálogo de Suprimentos aos tipos reais do Inventário, sem copiar equipamentos para `supply_units`. Na primeira abertura por administrador, o sistema registra somente os grupos de apresentação que faltarem; a operação usa uma chave única e pode ser repetida sem duplicar grupos. Os contadores e as variações são calculados dos itens físicos do Inventário em cada leitura. A migração também cria substituições transacionais com vínculos e histórico nos dois equipamentos. Aplique-a após a `059`, validando antes em ambiente de teste; até sua aplicação, a visualização agregada funciona em leitura, mas imagens de grupos novos e o comando de substituição dependem da nova estrutura.

A migração `061_integrated_inventory_supplies.sql` troca o status patrimonial legado **Troca** por **Inativo**, sem apagar unidades ou históricos; protege os metadados de itens espelhados para que só a imagem seja editável em Suprimentos; permite inativar individualmente as variações locais; e registra eventos idempotentes quando um envio para manutenção no Flux encontra uma TAG única no Inventário. Os saldos de variações inativas não entram na disponibilidade, mas permanecem registrados. A exclusão de um cadastro local vazio é lógica e auditada; cadastros com estoque ou histórico operacional devem ser inativados. Execute-a após a `060` e valide antes em uma base de teste. A migração altera registros com o status legado, portanto confira os totais e as integrações Controle TI/Flux antes da publicação em produção.
Substituições de equipamentos patrimoniais são iniciadas no Inventário; Suprimentos mantém apenas links de consulta e o histórico, sem oferecer alterações operacionais aos itens espelhados.

A migração `062_status_identity_safety.sql` consolida a resolução da identidade física por UUID, TAG e número de série. Ela mantém **Em uso** operacionalmente **Ativo**, trata **Aguardando avaliação** como **Manutenção** quando o equipamento sai de operação e conclui a manutenção em **Reserva**, sem reativar automaticamente o terminal anterior na Gestão TI. Execute-a após a `061`.

A migração `063_event_context_foundation.sql` prepara eventos compartilhados e efeitos por módulo, reutilizando o UUID do Inventário. Ela adiciona `event_id` opcional aos logs existentes e protege as novas tabelas com RLS. Não preenche históricos antigos nem liga, por si só, os produtores e consumidores de eventos; essa integração requer migrações posteriores. Execute-a após a `062`.

A migração `068_flux_source_identity.sql` guarda a origem explicitamente escolhida ao pesquisar TAG/série no Flux e valida a identidade no banco. Não associa movimentações antigas por semelhança de texto. Sem ela, o preenchimento manual permanece disponível, mas a seleção vinculada não é salva.

A migração `069_flux_inventory_acquisition.sql` registra a intenção de destino da aquisição e implementa a etapa Inventário. Somente o status **Recebido** permite a efetivação; a função transacional cria o equipamento em **Reserva** ou vincula uma identidade já existente, com evento e logs correlacionados. Repetições retornam o mesmo resultado. Suprimentos continua derivando a disponibilidade do Inventário, sem uma segunda entrada. Aplique após a `068`, preferencialmente primeiro em base de teste; esta etapa ainda não habilita os destinos Gestão TI e Suprimentos próprios nem substituições de PDV.

A migração `070_flux_management_computer_acquisition.sql` acrescenta o destino **Gestão TI > Computador**, sem ativar nem instalar automaticamente em um PDV. A escolha da área fica salva; após o recebimento, uma transação valida TAG e série, cria o computador em **Reserva** ou vincula um registro existente da mesma área, com evento e logs. Exige a `069` previamente aplicada e uma tabela da Gestão TI já inicializada. Teste primeiro em ambiente de homologação. Periféricos, substituições e Suprimentos próprios continuam para etapas posteriores.

A migração `071_flux_local_supply_acquisition.sql` acrescenta a entrada de aquisições recebidas no Flux em **itens próprios de Suprimentos**, inclusive uma variação local existente. Exige a `070` previamente aplicada. O usuário informa uma quantidade inteira positiva e confirma a prévia de saldo; a transação credita somente o saldo base **ou** o da variação, uma única vez, e registra movimentação, logs e evento compartilhado. Itens projetados do Inventário não recebem segundo crédito. Esta etapa não cria variações no assistente nem trata substituição de periférico/PDV; uma variação nova deve ser criada em Suprimentos antes de reabrir o assistente. Teste primeiro em homologação e confira o estoque antes e depois da aplicação. Até aplicar a `071`, o destino permanece oculto na interface.

A migração `072_flux_management_maintenance.sql` corrige o envio para manutenção de computadores escolhidos na **Gestão TI**. Requer `063`, `044` e `068`; pode ser aplicada independentemente da `071`. O gatilho preserva o caminho existente do Inventário e, para um vínculo explícito da Gestão TI, grava evento e logs, atualiza o mesmo computador e confirma o chamado vinculado no Controle TI na transação do salvamento. A tabela do mês atual do Controle TI deve existir. Se faltar ou houver conflito de TAG/série, o salvamento inteiro falha sem registrar uma movimentação parcial. Não altera dados antigos; valide em homologação antes de aplicar à base real.

A migração `073_control_maintenance_completion.sql` corrige a conclusão bidirecional. A interface exige escolher **Ativo** ou **Reserva**; a função transacional atualiza o chamado e o equipamento de origem, preserva localização e histórico do Flux, e grava logs/eventos com o mesmo ID. Um erro de vínculo, permissão ou gravação cancela toda a operação. Ela impede que uma situação antiga de manutenção na Gestão TI reabra o chamado e bloqueia a conclusão direta de chamados vinculados fora do fluxo. Aplique após a `072`, primeiro em homologação, e valide um caso de cada origem e destino antes de usar em produção. Esta migração não reconcilia registros anteriores.

## Permissões

As migrações `015_authentication_and_permissions.sql` e `018_fiscal_nfe.sql` aplicam as políticas de acesso por usuário e função. Depois de publicar alterações de segurança, valide o bloqueio anônimo com:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL = 'https://seu-projeto.supabase.co'
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sua-chave-publica'
npm run verify:rls
```

O comando não grava nem remove dados. Ele confirma que as tabelas corporativas não podem ser lidas anonimamente.

## Dados sensíveis

Nunca registre no Git, em prints ou em mensagens:

- `SUPABASE_SERVICE_ROLE_KEY`
- arquivos `.env`
- `supabase-config.js`

Use a chave de serviço somente no ambiente seguro de administração/automação. A interface do navegador utiliza apenas a chave pública.
