# Operação do ALDECKOT

## Rotina antes de publicar

Use Node.js 20 ou superior e execute, na raiz do projeto:

```powershell
npm run verify
npm run check:migrations
```

Esses comandos validam a sintaxe, a presença dos recursos essenciais, os testes locais e a sequência das migrações. A mesma validação é executada automaticamente para alterações enviadas à `main` pelo GitHub Actions.

Para verificar a comunicação completa com o Supabase em um ambiente de teste, utilize `npm run verify:supabase`. Esse teste cria e remove dados temporários; não o execute em produção sem uma janela de manutenção e confirmação da equipe responsável.

## Saúde e monitoramento

A rota `GET /api/health` confirma que a publicação e o serviço de autenticação estão acessíveis. Ela retorna `200` quando está saudável e `503` quando há indisponibilidade.

Configure um monitor externo para consultar `https://SEU-DOMINIO/api/health` a cada cinco minutos e avisar por e-mail/WhatsApp quando houver falha. A criação da conta e dos alertas depende do serviço de monitoramento escolhido e deve ser feita pelo responsável da conta.

O navegador também reporta erros inesperados de forma resumida para `/api/client-error`. Nenhum campo de formulário, token, URL completa ou informação pessoal é enviado nesse relatório.

## Cópias de segurança e recuperação

O sistema mantém cópias dos módulos no banco. Antes de qualquer atualização estrutural:

1. Exporte uma cópia do banco pelo painel do Supabase.
2. Confirme uma cópia recente de cada módulo:

```powershell
$env:SUPABASE_URL = 'https://seu-projeto.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = 'chave-de-servico-apenas-no-terminal-seguro'
npm run verify:backups
```

3. Teste a restauração em um projeto de homologação pelo menos uma vez por trimestre.
4. Registre data, responsável, resultado e qualquer ação corretiva.

O comando acima consulta somente a data do backup mais recente. Por padrão, ele exige cópias com no máximo sete dias. Para outro limite, defina `ALDECKOT_BACKUP_MAX_AGE_HOURS`.

## Segurança aplicada no aplicativo

- Proteção contra excesso de tentativas nas rotas de login, cadastro e criação inicial de conta.
- Cabeçalhos para reduzir execução de conteúdo indevido, incorporação por sites externos e permissões desnecessárias do navegador.
- Políticas de acesso do banco por usuário e função.
- Registro técnico mínimo de erros e rota de saúde.

O limitador atual é uma camada leve em memória. Para proteção distribuída contra abuso em produção, habilite também os controles de firewall/rate limit da Vercel ou outro provedor de borda usado pela organização.

## Em caso de incidente

1. Suspenda a publicação ou revogue sessões quando houver suspeita de acesso indevido.
2. Preserve os registros de auditoria e anote horário, usuários envolvidos e telas afetadas.
3. Faça a validação de RLS antes de reabrir o sistema.
4. Restaure a cópia validada somente em ambiente de homologação primeiro; depois, com aprovação responsável, execute a recuperação em produção.
5. Troque imediatamente qualquer segredo que possa ter sido exposto.
