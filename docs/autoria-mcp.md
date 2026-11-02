# Autoria e retomada pelo MCP

`capabilities` lista as tarefas tipadas; o recurso `um://assistant/guidance` orienta a primeira e a segunda tomada. A autoria acontece no ChatGPT. O aplicativo apresenta formulário, estudo e colaboração.

`project_get` recupera o projeto, as participações, as revisões e a próxima ação. `authoring_list` pagina as preparações. `authoring_get` apresenta o índice, as quantidades por espécie e a próxima etapa registrada pelo autor. A consulta não altera leitura nem declara aprendizagem.

Para uma produção extensa:

1. Abra `authoring_create`, indicando o alcance comum ou pessoal, a revisão publicada esperada e a base. A preparação pessoal exige submissão vigente do titular.
2. Grave unidades, recursos, práticas, cobertura e justificativas com `authoring_save`. Cada lote contém até 20 itens integrais, uma revisão esperada e a próxima etapa. `authoring_items` lê os itens integralmente, em páginas vinculadas à revisão. Justificativas só pertencem ao alcance pessoal.
3. Confira o conjunto e salve a inspeção IA explicitamente. Uma alteração de conteúdo invalida a inspeção anterior. Inspeção IA não representa revisão humana.
4. Chame `authoring_publish` com a revisão da preparação. A publicação verifica novamente fontes, âncoras, cobertura, respostas, permissões e concorrência; ativa o manifesto inteiro e reutiliza os arquivos preparados. A versão anterior continua acessível enquanto a nova é preparada. Não é necessário retransmitir todo o conteúdo.

Cada escrita usa uma `operationId` estável. Após resposta perdida, consulte `operation_get`; não invente outra tentativa. Revisão conflitante exige releitura. Preparação publicada é imutável; abra outra preparação para a próxima publicação. `authoring_delete` abandona apenas uma preparação ainda aberta, enfileirando seus arquivos para remoção. Perfis exportam também os índices de suas preparações e arquivos permitidos pelos direitos. Revogação corta o acesso do antigo criador, inclusive aos rascunhos.

`invite_list` recupera convites paginados, sem devolver tokens nem seus hashes. `catalog_list` pagina os métodos e recursos efetivos da conta. A edição dos parâmetros do projeto usa `project_update.metadata.configuration`, separando decisões editoriais e instrucionais.

`source_revise` aceita texto, metadados ou ambos e exige motivo e revisão esperada. Revisões conservam os metadados e os bytes anteriores; `source_history` permite consultá-las. Corrigir uma fonte sinaliza correção nos projetos dependentes, sem alterar material publicado. `source_detach` só retira vínculos ainda não usados por publicação; `source_delete` recusa fontes ainda vinculadas a qualquer projeto. A exclusão dos bytes passa pela fila de remoção e pela API de Storage.

Essas tarefas fazem parte do catálogo MCP e não oferecem SQL arbitrário. A prova local por API/SDK não certifica anexo nem consentimento no host ChatGPT Web.
