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

O MCP usa autorizações próprias do Um: código de uso único, PKCE S256, recurso
exato e tokens opacos. O consentimento abre uma sessão de conta separada, mantida
somente em memória no aplicativo. O servidor guarda sua renovação cifrada com uma
chave exclusiva, sem alterar o hook OAuth do serviço compartilhado. Revogar o cliente
invalida suas autorizações anteriores; autorizar novamente não reativa tokens antigos.
O consentimento de leitura também não ganha escrita por uma mudança posterior.

Node e o adaptador de Edge usam `src/http.ts`. A preparação por
`scripts/stage-edge.ts` copia apenas fontes de runtime e dependências fixadas;
`--release` exige árvore limpa e `UM_CANDIDATE_SHA` igual ao HEAD. A função hospedada
exige HTTPS e chave pública para operações do Storage com o JWT de cada usuário.
As transações assumem papéis limitados; o papel público não acessa o estado OAuth.

As políticas em `supabase/storage/um-private.sql` são aditivas e específicas do
bucket Um. Leitura depende dos metadados autorizados; um pedido de remoção permite
somente a operação de remover, sem permitir download ou URL assinada. A confirmação
da fila exige que a linha do Storage tenha desaparecido. A remoção física usa a API
de Storage, nunca `DELETE` direto em `storage.objects`.
