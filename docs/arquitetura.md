# Fundação do Um

O Um separa o estudo comum dos formulários, complementos e estado pessoal. O
frontend TypeScript é compartilhado por Pages e Android. O servidor valida tarefas
tipadas, autorização e revisões; a conversa ativa produz o material. Não há modelo
executando no backend ou no dispositivo.

`src/contracts.ts` fixa os contratos dos consumidores. Âncoras identificam fonte,
revisão, bloco e intervalo em pontos de código Unicode. Formulários declaram apenas
condições sobre perguntas anteriores. Conteúdo pessoal e sua justificativa não
integram o manifesto comum. Publicação muda uma referência ativa somente depois
da validação de todos os arquivos preparados.

Identidade vem de JWT verificado e sessão ainda ativa. Perfil, participação e
permissão são registros distintos; nomes nunca autenticam. Banco e Storage
revalidam acesso. Cada tentativa de escrita tem chave estável e recibo no mesmo
commit; uma resposta perdida é recuperada por consulta, sem repetir efeitos.

O namespace SQL `um` e o bucket privado próprio serão criados aditivamente após
os gates de preservação. A configuração de Auth compartilhada não será substituída.
Arquivos grandes ficam no Storage; o banco mantém índices, permissões e metadados.
O desenho não é prova de implantação ou de autorização: os resultados executados
e os limites constam do STATUS.
