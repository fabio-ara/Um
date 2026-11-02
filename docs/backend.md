# Backend e provas locais

O adaptador `supabase/functions/um-api/index.ts` compartilha o contrato HTTP/MCP
do servidor Node. Prepare com `npx tsx scripts/stage-edge.ts` e confira com Deno
usando o `deno.json` gerado e o lock versionado. A publicação exige a candidata
revisada e limpa, identificada por `UM_CANDIDATE_SHA`; preparar não publica.

O gateway hospedado encaminha o caminho com o nome da função, sem `/functions/v1`.
O adaptador restaura a URL pública antes do handler compartilhado, preservando
corpo, autorização e query de OAuth. Somente o prefixo da função configurada é
traduzido; rotas de outras funções não são aceitas. Veja o [contrato de roteamento
do Supabase](https://supabase.com/docs/guides/functions/http-methods).

Configuração hospedada: `SUPABASE_URL`, chave pública `SUPABASE_ANON_KEY` ou
`SUPABASE_PUBLISHABLE_KEY`, conexão de banco do servidor e `UM_OAUTH_ENCRYPTION_KEY`
(32 bytes aleatórios em base64url). `APP_ORIGIN` aponta para o Pages do Um;
`API_ORIGIN` aponta para a função Um. Chaves administrativas são rejeitadas na
configuração pública. Segredos ficam no ambiente de execução, fora do frontend.

No Supabase, `SUPABASE_DB_URL` já é fornecida ao runtime. A migração de papel
hospedado permite que sua conexão `postgres` assuma `um_oauth_server` durante
as transações do broker. Esse papel não tem login e não é concedido a `anon`
ou `authenticated`; as operações do usuário continuam assumindo `authenticated`
com as claims verificadas. Não alterar credenciais ou hooks dos outros produtos.

Antes de qualquer migração no projeto compartilhado, confira o inventário, faça
backup de todos os schemas de domínio e Auth/Storage e copie os objetos pela API.
Restaure em uma instância isolada e compare cada tabela por contagem e SHA256,
incluindo metadados de versões que a CLI pode omitir. Validadores `CHECK` que
consultam catálogos precisam ser restaurados após os dados; preserve definições,
estado dos gatilhos e revalide as chaves estrangeiras. Ensaie todas as migrações
Um e as políticas Storage, verificando a conservação das estruturas anteriores.

Rollback de aplicação volta a uma revisão previamente compatível da função e do
frontend. Não remova o schema Um, objetos ou dados criados após a publicação.
Uma incompatibilidade de dados exige correção aditiva; não restaure um snapshot
por cima de dados novos. Hooks de Auth e produtos irmãos não são parte do deploy.

Para a prova local de Storage, inicialize primeiro o compose e as migrações Um.
`scripts/local-storage-setup.ts` gera configuração privada para Storage API
`public.ecr.aws/supabase/storage-api:v1.73.1`, na rede `um_default`, porta local
4422 e volume exclusivo. Aplique `scripts/local-storage-bootstrap.sql` somente
ao banco local `um`, seguido de `supabase/storage/um-private.sql` e
`supabase/storage/um-private-hardening.sql`, nessa ordem. O bootstrap
reproduz os papéis internos do Supabase; não é uma migração hospedada.

Execute `tests/storage.integration.test.ts` com `UM_STORAGE_PROOF=1`. A prova usa
Auth/PostgreSQL/Storage reais, um prefixo HTTP local e uma interrupção explícita
para verificar retomada. Uma política permissiva adicional simula um produto
vizinho e confirma que a política restritiva Um continua exigindo sua autorização.
A prova também inspeciona o volume do contêiner `um-storage`.
`tests/oauth.browser.ts` aceita `UM_PROOF_API_ORIGIN` e `UM_PROOF_APP_ORIGIN` para
exercitar o mesmo fluxo no Node e no Deno. Carregue `.env` ao iniciar o executor
das provas de navegador. Nenhuma dessas provas substitui o host ChatGPT, backend
hospedado ou APK assinado.
