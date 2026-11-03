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

A configuração hospedada de SMTP foi concluída com credenciais fornecidas pelo titular. Cadastro e recuperação entregaram e-mails reais; os links recebidos abriram o Pages e a nova senha foi validada por login. As confirmações continuam obrigatórias, e a configuração dos produtos anteriores foi preservada. Convites de perfil continuam sendo compartilhados por quem prepara o estudo.

A correção 0.1.2 atende a uma incompatibilidade encontrada na conexão real ao ChatGPT: a autenticação foi aceita, mas a descoberta rejeitou o esquema de `project_create`. A validação Unicode dos nomes de parâmetros permanece no servidor e deixa de ser exportada como expressão dependente de flags no catálogo MCP. A correção alcança as cinco ferramentas que usam essa configuração; as formas dos dados e as permissões permanecem iguais. A conexão e a jornada completa só contam como homologadas após a verificação hospedada registrada nas issues.

Na verificação hospedada de 3 de novembro de 2026, o ChatGPT aceitou o catálogo, criou e consultou um perfil próprio e retomou um projeto sintético em outra conversa. Recuperou a submissão existente e publicou material comum e complemento pessoal. A submissão foi enviada pela API autenticada do aplicativo, sem alegação de preenchimento humano pela interface nesta prova. Conteúdo malicioso no documento e na resposta não alterou permissões nem expôs o canário privado nos 14 conteúdos publicados. As fixtures foram removidas, preservando o perfil real.

O mesmo APK release 0.1.2 foi instalado no emulador Android 15/API 35. TalkBack 15 anunciou controles icon-only, acompanhou o foco e a ativação pelo teclado. A fonte do sistema a 200% reorganizou a entrada e a Conta com rolagem. Essa prova focal dos controles observados complementa as capturas e interações web anteriores; não cobre todos os percursos com TalkBack, aparelho físico ou todos os leitores de tela. O anexo real pelo ChatGPT Web continua pendente e impede o encerramento global. O estado corrente de cada aceite permanece nas [issues de entrega](https://github.com/fabio-ara/Um/issues/1).
