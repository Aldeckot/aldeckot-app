# Laboratório local de movimentações da Gestão TI

Este ambiente usa PostgreSQL embarcado (PGlite) **somente em memória** e dados
inteiramente fictícios. Não lê configurações, credenciais ou registros do
Supabase. Cada execução começa com três posições (RES 02, PDV 01, PDV 02),
dois computadores fictícios e um monitor fictício do Inventário.

Execute na pasta `tests/local-management`:

```powershell
pnpm install --frozen-lockfile
pnpm test
```

`scenarios.mjs` simula as regras em um esquema mínimo. `rpc-integration.mjs`
carrega as migrações reais 087, 088 e 089 sobre 33 posições e 20 PCs fictícios.
Também instala, diretamente dos arquivos originais, as funções de identidade,
classificação de periféricos, guarda de PDV, criação de chamados e guarda de
vínculos das migrações 038, 043, 044, 062, 073, 084 e 086. Os testes cobrem troca nos dois
sentidos, status e localização independentes, monitor fixo no PDV, histórico
por PC/posição, chamado por Defeito, tentativa sem localização final, falha
durante a sincronização e ausência da tabela mensal do Controle TI (ambas com
rollback), reenvio idempotente, transferência direta
para PDV vazio, chamado histórico sem identidade, disputa simultânea pelo PDV,
bloqueio de substituto já instalado em outro PDV e status final incompatível.

Na raiz do projeto, `pnpm exec playwright test
e2e/management-movement-wizard.spec.mjs` verifica no navegador as duas entradas
da substituição e a transferência direta para PDV vazio. Esse teste intercepta
o cliente de dados e bloqueia toda conexão externa; usa somente registros
fictícios e confirma o plano enviado após as cinco etapas, sem gravar no banco.

**Limite importante:** as tabelas e os demais gatilhos do fixture continuam
simplificados; isto não é um clone da base principal. Os testes de navegador e
da RPC são separados; ainda não há
teste ponta a ponta da interface contra a RPC real, nem cobertura dos dados
legados completos. O usuário informou uma auditoria somente leitura que confirmou
a RPC da 088 instalada na base principal; isso não equivale a um teste real de
movimentação. Nenhum teste deste laboratório acessa essa base. O assistente de
cinco etapas deve continuar sendo validado aqui antes de qualquer operação real.
O bloqueio de substituto já instalado em outro PDV está no cliente e na 089
preparada localmente. Em 21/10/2026, o usuário informou sua aplicação à base
principal e enviou auditoria estrutural com `migration_089_verified = true`.
Esse resultado não substitui um teste integrado com dados fictícios num clone
fiel do Supabase; não executar movimentações de teste na base principal.
