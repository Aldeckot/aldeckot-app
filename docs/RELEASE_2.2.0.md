# ALDECKOT 2.2.0 — entrega de código

Esta entrega foi preparada sobre a `main` publicada no commit `de9db80`, preservando o histórico do repositório. O código e as páginas exibem a versão `2.2.0`.

## Verificações

- `node scripts/check-version.mjs`: aprovado.
- `node scripts/check-project.mjs`: aprovado.
- `node scripts/check-migrations.mjs`: aprovado; as migrações existentes na `main` não foram alteradas.
- `node --test`: 372 testes aprovados.
- Playwright no Chrome local: 87 cenários aprovados; os dois cenários que presumiam o modo antigo da Central de Operações foram atualizados e aprovados novamente.
- `git diff --check`: aprovado. Nenhum arquivo de credenciais ou configuração local do Supabase foi incluído.

## Verificação de produção em 21/11/2026

O código incorpora migrações de `095` a `130`. O histórico do repositório remoto terminava em `094`, mas isso não representava o estado do banco. Consultas somente leitura ao projeto de produção confirmaram marcos estruturais e funções das migrações `112`–`130`, a definição de leitura da `130` e um job ativo de vencimento da limpeza. Como não há uma tabela de histórico de migrações disponível, essas consultas não provam a identidade de cada definição com o arquivo local. Nenhuma migração foi executada nesta entrega.

Foi gerado um backup lógico atualizado em `C:\Users\ricardon\AppData\Local\ALDECKOT\backups\postgres-rwehxhrxomyserxvwymf-20261121T153737Z`, fora do Git. Os hashes e a leitura integral do arquivo foram conferidos. As contagens de oito tabelas-chave coincidiram com a produção, incluindo autenticação e metadados do Storage. Os 48 arquivos físicos foram copiados de arquivos ZIP previamente validados: os caminhos e tamanhos coincidem com o dump atual e nenhum objeto foi modificado após aquela cópia. A extração e os hashes dos 48 arquivos passaram.

O restore em PostgreSQL local recuperou 65 tabelas públicas, 2 usuários de autenticação e 48 metadados de objetos; houve 9 erros por extensões e dependências próprias do Supabase, ausentes no servidor local. A restauração deste arquivo exato em um projeto Supabase hospedado ainda não foi testada. Uma cópia anterior foi restaurada no projeto Free de testes. A implantação do código é reversível e não requer alterar o banco nesta etapa; a limitação do teste de restauração permanece registrada no backup.
