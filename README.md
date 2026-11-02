# Um

Leitura e estudo em Humanidades. Autoria pelo ChatGPT/MCP; preparação e estudo no
aplicativo web/Android. Programa `UM-20261101-v1` em estabilização, ainda sem release.

Para desenvolvimento local, com Node 24.14+ e Docker:

```sh
npm ci
npm run local:setup
docker compose up -d
npm run db:migrate
npm run dev
```

Em outro terminal, `npm run web`. A interface usa `http://127.0.0.1:4419` e a API
`http://127.0.0.1:4417`. O ambiente é exclusivo do Um. Credenciais geradas, arquivos
locais e worktrees ficam ignorados pelo Git. Não use os valores locais em produção.

Validações focais são selecionadas por arquivo, por exemplo:

```sh
npm run check
npx tsx --env-file-if-exists=.env --test tests/authoring.integration.test.ts
npx playwright test tests/offline.browser.ts
```

As provas de integração usam PostgreSQL e GoTrue reais locais. A prova offline usa
IndexedDB no Chrome. Os serviços remotos e o cliente ChatGPT exigem evidências
próprias. [Estado da entrega](STATUS.md).

Extração, padrões de transação/HTTP e utilidades reaproveitam AraRead; tokens e
ícones reaproveitam AraLearn; o contrato de anexos considera AraHub. Todos sob MIT,
Copyright © 2026 Fabio Ara. Os produtos de origem permanecem independentes.
