# Estado e verificação da entrega

O Um tem uma implementação do programa UM-20261101-v1, contrato 1.0. A revisão efetivamente distribuída deve ser conferida nos canais abaixo; um commit ou build isolado não equivale à aprovação de todos os aceites.

- [Aplicativo web](https://fabio-ara.github.io/Um/)
- [Releases e APK](https://github.com/fabio-ara/Um/releases)
- [CI e publicação](https://github.com/fabio-ara/Um/actions)
- [Entrega integrada e evidências por frente](https://github.com/fabio-ara/Um/issues/1)

O frontend e o APK incluem `build-identity.json` com revisão, endpoint e estado da árvore de origem. O APK release usa uma assinatura própria, distinta do debug e dos demais produtos. A função hospedada se chama `um-api`; as migrações são aditivas no domínio Um e preservam os dados e mecanismos dos produtos anteriores.

A base de validação local executou 72 testes de domínio/integração sem skips, incluindo Auth, PostgreSQL, Storage e demonstração documental. O gate Chrome teve 25/27 casos verdes; as duas falhas corrigidas passaram focalmente. Novas provas cobrem erro de primeira abertura, painel de conexão e roteamento do gateway. OAuth/MCP, continuidade offline e Android têm evidências separadas, com seus ambientes e revisões registrados nas issues.

A demonstração foi revisada independentemente. Isso não é revisão humana nem evidência de eficácia pedagógica. Callback OAuth sintético não comprova anexo no ChatGPT Web; inspeção automática de acessibilidade não comprova leitor de tela. As verificações indisponíveis continuam explícitas nos aceites, sem marcação de aprovação por inferência. Consulte [validação e entrega](docs/validacao-entrega.md) para comandos, identidade dos artefatos e limites das provas.

A correção 0.1.1 completa o primeiro acesso (perfil próprio sem convite e orientação MCP), links diretos de preparação, paginação da home, leitura durante nova preparação, formulário de uma pergunta por vez e recuperação de senha. Os testes focais usam Auth/PostgreSQL reais locais e Chrome; incluem perda de resposta, retomada e isolamento entre contas. Recuperação por link real local não comprova entrega de e-mail no serviço hospedado. O fechamento da versão e seus limites estão registrados na issue coordenadora; nenhuma dessas provas substitui a jornada no ChatGPT Web. Autoria e parâmetros continuam exclusivamente no MCP.

A inspeção hospedada identificou que o Auth ainda usa o remetente padrão, restrito à equipe do projeto. Cadastro com confirmação e recuperação por e-mail para o público dependem de credenciais e remetente SMTP autorizados. Não foram desativadas as confirmações nem modificadas contas existentes para contornar essa limitação.
