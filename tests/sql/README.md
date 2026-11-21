# Banco local isolado para migrações

Execute na raiz do projeto, no PowerShell:

```powershell
& .\tests\sql\run-local-migrations.ps1
```

O comando exige o WSL `podman-uosserver` e a imagem `docker.io/library/postgres:16-alpine` já em cache. Ele cria um PostgreSQL temporário sem rede, portas ou volumes, aplica as migrações desde a 001, usa apenas uma conta e equipamentos fictícios, verifica o backfill e as transições da 095 e elimina o contêiner ao terminar (também em caso de erro). Nunca lê `.env` ou credenciais de produção.

`local-supabase-bootstrap.sql` reproduz somente os contratos PostgreSQL de Auth e Storage necessários às migrações; não substitui os serviços completos do Supabase. As migrações 084–087 e 093 contêm correções ou contagens vinculadas a equipamentos reais. O executor confere os hashes dos arquivos antes de aplicar somente suas partes estruturais; a 085 é inteiramente uma reconciliação histórica de dados e é omitida. Portanto, este teste valida o esquema resultante e a migração 095 com dados fictícios, **não** valida a correção de dados reais dessas etapas históricas.

O resultado esperado termina com `PASS: offline migrations, fictional backfill, case transitions and rollback.`. Nenhum teste local autoriza aplicar migrações ao projeto de produção sem uma revisão e um backup separados.
