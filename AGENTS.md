# Regra de versão do ALDECKOT

- Toda entrega que altere qualquer arquivo do projeto deve incrementar a versão do sistema em relação à versão anterior. Use o próximo número de correção (`patch`) por padrão; escolha um incremento maior apenas quando fizer sentido para a mudança.
- Mantenha o mesmo número em `package.json`, nas duas entradas de `package-lock.json`, em `system-version.js`, no texto inicial da marca na Home (`index.html`) e na chave de cache do carregamento de `system-version.js`.
- Antes de concluir, execute `npm run verify` e `npm run check:migrations`. A verificação de versão também deve passar. Não publique se houver alterações preexistentes de outra origem ou verificações com falha.
