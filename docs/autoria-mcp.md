# Autoria e retomada pelo MCP

`capabilities` lista as tarefas tipadas; o recurso `um://assistant/guidance` orienta a primeira e a segunda tomada. A autoria acontece no ChatGPT. O aplicativo apresenta formulário, estudo e colaboração.

`project_get` recupera o projeto, as participações, as revisões e a próxima ação. `authoring_list` pagina as preparações. `authoring_get` apresenta o índice, as quantidades por espécie e a próxima etapa registrada pelo autor. A consulta não altera leitura nem declara aprendizagem.

Para uma produção extensa:

1. Abra `authoring_create`, indicando o alcance comum ou pessoal, a revisão publicada esperada e a base. A preparação pessoal exige submissão vigente do titular.
2. Grave unidades, recursos, práticas, cobertura e justificativas com `authoring_save`. Cada lote contém até 20 itens integrais, uma revisão esperada e a próxima etapa. `authoring_items` lê os itens integralmente, em páginas vinculadas à revisão. Justificativas só pertencem ao alcance pessoal.
3. Confira o conjunto e salve a inspeção IA explicitamente. Uma alteração de conteúdo invalida a inspeção anterior. Inspeção IA não representa revisão humana.
4. Chame `authoring_publish` com a revisão da preparação. A publicação verifica novamente fontes, âncoras, cobertura, respostas, permissões e concorrência; ativa o manifesto inteiro e reutiliza os arquivos preparados. A versão anterior continua acessível enquanto a nova é preparada. Não é necessário retransmitir todo o conteúdo.

Cada escrita usa uma `operationId` estável. Após resposta perdida, consulte `operation_get`; não invente outra tentativa. Revisão conflitante exige releitura. Preparação publicada é imutável; abra outra preparação para a próxima publicação. `authoring_delete` abandona apenas uma preparação ainda aberta, enfileirando seus arquivos para remoção. Perfis exportam também os índices de suas preparações e arquivos permitidos pelos direitos. Revogação corta o acesso do antigo criador, inclusive aos rascunhos.

Se outra publicação mudar a base durante a preparação, `authoring_rebase` registra explicitamente a nova base e a revisão publicada esperada, preservando os itens já gravados. Isso invalida a inspeção; o autor deve revisar âncoras, unidades, recursos e justificativas. Não há realinhamento nem personalização automáticos.

`invite_list` recupera convites paginados, sem devolver tokens nem seus hashes. `catalog_list` pagina os métodos e recursos efetivos da conta. A edição dos parâmetros do projeto usa `project_update.metadata.configuration`, separando decisões editoriais e instrucionais.

`source_revise` aceita texto, metadados ou ambos e exige motivo e revisão esperada. Revisões conservam os metadados e os bytes anteriores; `source_history` permite consultá-las. Corrigir uma fonte sinaliza correção nos projetos dependentes, sem alterar material publicado. `source_detach` só retira vínculos ainda não usados por publicação; `source_delete` recusa fontes ainda vinculadas a qualquer projeto. A exclusão dos bytes passa pela fila de remoção e pela API de Storage.

Permissões de arquivo vigentes também limitam a entrega de revisões antigas. Ao reconectar, o aplicativo confere as revisões instaladas e retira pacotes cuja permissão offline terminou, conservando notas, rascunhos de formulário e operações pendentes. Textos consultados online só ficam disponíveis offline quando integram um pacote permitido preparado explicitamente. Uma cópia exportada para fora do aplicativo não pode ser recolhida pelo serviço.

Essas tarefas fazem parte do catálogo MCP e não oferecem SQL arbitrário. A prova local por API/SDK não certifica anexo nem consentimento no host ChatGPT Web.
# Parâmetros por alcance

`parameter_get` lê escolhas e intenções de conta, projeto ou unidade. `parameter_save`
grava somente uma alteração pedida, com `operationId` e `expectedRevision`; uma
consulta ou proposta não escreve. Projeto usa a mesma configuração canônica de
`project_get`/`project_update`. Unidade precisa existir em uma preparação salva ou
publicação. Somente o autor administra esses parâmetros; não há painel pedagógico
no aplicativo de estudo.

As chaves de `configuration.editorial` e `configuration.instructional` presentes
são escolhas fixadas. Chaves ausentes permitem decisão automática. A resolução
aplica conta, projeto e unidade nessa ordem, informa cada substituição em
`overrides` e acumula `requirements` sem uma regra local apagar exigências herdadas.
Para voltar a uma escolha herdada, remova a chave do alcance local com nova revisão.
`intention` conserva o pedido que motivou a alteração.

Unidades, recursos e escolhas registram `appliedConfiguration` com os dois grupos
efetivamente usados, incluindo decisões automáticas. Recursos locais informam
`unitId`. A publicação rejeita divergência nas escolhas fixadas, conserva o retrato
dos requisitos no manifesto e mantém versões anteriores. Intenções privadas de
conta não são copiadas para o manifesto comum. O servidor verifica estrutura e
coerência; a inspeção editorial verifica se o texto cumpre os requisitos. Alterar
parâmetros não regenera estudos publicados.
Alterações de parâmetros invalidam a inspeção das preparações abertas afetadas,
inclusive quando mudam apenas requisitos. `project_update` também exige a intenção
ao modificar configuração ou requisitos; não permite contornar essa regra.
