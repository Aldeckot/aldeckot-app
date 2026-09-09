# ALDECKOT

Sistema corporativo para inventário, gestão de terminais, Controle TI, transferências, ocorrências fiscais e agenda operacional.

## Desenvolvimento local

Use Node.js 20 ou superior. O projeto não exige dependências externas para validar a base atual.

```powershell
npm run serve
```

Abra `http://localhost:4173`. Para conectar a cópia local ao Supabase, preencha as variáveis necessárias no arquivo `.env` e gere a configuração local:

```powershell
npm run build:config
```

O arquivo gerado `supabase-config.js` é local e não deve ser enviado ao Git.

## Qualidade

```powershell
npm run verify
npm run check:migrations
```

Os comandos validam o código, a estrutura essencial, os testes automatizados e a sequência de migrações. O GitHub Actions repete essas verificações para alterações destinadas à branch `main`.

## Publicação e operação

- A publicação é configurada pela Vercel em [`vercel.json`](vercel.json).
- As rotas `api/` mantêm as operações sensíveis no servidor.
- As migrações e sua política de execução estão descritas em [`supabase/README.md`](supabase/README.md).
- O checklist de saúde, backup e recuperação está em [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

Nunca publique chaves de serviço, arquivos `.env` ou `supabase-config.js`.
