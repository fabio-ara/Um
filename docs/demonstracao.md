# Demonstração editorial local

Com o ambiente local inicializado, execute `scripts/demo-catalog.ts` e
`scripts/demo-local.ts` com `tsx --env-file=.env`. Contas e perfis são sintéticos;
as fontes são edições reais adquiridas com direitos registrados. O recibo com
credenciais fica somente em `.local/demo.json`, ignorado pelo Git.

O estudo da *Apologia* trabalha 17a–17d e 21a–21e, mantendo as edições integrais
de Burnet e Fowler disponíveis para consulta. As referências incluem cada
parágrafo completo, inclusive a distinção de 21d, sem corte arbitrário de
caracteres. O comentário é interpretação didática, sem alegação de transcrição
histórica do julgamento. Dois perfis recebem apoios substantivamente distintos:
casos cotidianos e contrastes entre hipótese e evidência, com justificativas privadas.

Para uma demonstração criada antes dessa correção, `scripts/demo-upgrade.ts`
publica revisões novas, conservando identidades de conteúdo, revisões anteriores,
formulários, submissões e registros pessoais. O recibo persistido permite retomar
sem duplicar a publicação. Execute essa atualização antes do tema se a base antiga
já estiver no banco; bases novas já usam as âncoras completas.

`scripts/demo-theme.ts` acrescenta um estudo comparativo entre *Apologia* 21 e
*Analectos* II.17, reutilizando as duas fontes da *Apologia* e os mesmos perfis.
O trecho dos *Analectos* é identificado como fragmento da tradução inglesa de
James Legge. Não há original chinês reconstruído nem afirmação de transmissão
histórica entre as obras. O arquivo adquirido repete a numeração XVII na seção
seguinte; a extração termina no próximo cabeçalho e conserva apenas II.17.

A prova `tests/demo.integration.test.ts`, habilitada por `UM_DEMO_PROOF=1`, verifica
as publicações, âncoras nas fontes, limites do fragmento e diferenciação pessoal.
`tests/demo.browser.ts` exercita fontes, retorno à origem, apoio preparado e abas
por teclado a 320 px. Isso demonstra funcionamento; não comprova eficácia
educacional, revisão humana ou experiência no host ChatGPT.
