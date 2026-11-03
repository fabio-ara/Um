# Primeiros passos no Um

O Um conecta o ChatGPT à preparação do estudo e o aplicativo ao estudo em si. A autoria e as decisões pedagógicas acontecem na conversa com o ChatGPT; o aplicativo apresenta o formulário, a leitura, as fontes, as escolhas, as notas e a colaboração.

## Antes de começar

Entre no aplicativo com e-mail e senha. Uma conta AraLearn existente compartilha a mesma autenticação; não é preciso criar outra. Seus dados de acesso não devem ser divulgados.

Se você vai estudar por conta própria, não precisa de convite. Use o botão **Criar meu perfil** no aplicativo e siga para a conversa com o ChatGPT.

Se outra pessoa está preparando o estudo para você, ela cria o perfil e gera um convite. O link do convite é compartilhado por ela no canal que preferir; o Um não envia e-mail automaticamente. Aceite o convite na sua Conta.

## Conectar o Um ao ChatGPT

O caminho abaixo segue a [documentação oficial do ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt), conferida em 2 de novembro de 2026. A conexão e a retomada de autoria do Um foram verificadas no ChatGPT; a disponibilidade pode variar conforme a conta e as regras do espaço de trabalho. Consulte o [estado da entrega](../STATUS.md) para o alcance das provas e as pendências.

1. No ChatGPT, abra **Plugins**, escolha **+** e **Adicionar servidor MCP personalizado**.
2. Informe o nome **Um**, uma descrição e o endereço público do servidor, terminado em `/mcp`:

   `https://jrfkphuhcseqmratijjr.supabase.co/functions/v1/um-api/mcp`

3. Escolha a autenticação **OAuth**. Em **Configurações avançadas de OAuth**, mantenha o registro dinâmico (DCR), os escopos `um.read` e `um.write` e desative **OIDC habilitado**, caso o ChatGPT o tenha marcado: o Um usa OAuth sem OpenID Connect. Entre com a mesma conta usada no aplicativo. O host apresenta seus próprios avisos e pede consentimento; autorize a leitura e a escrita.
4. Marque **Create as a plugin**, instale e, em uma conversa nova, selecione **@Um**.

O aplicativo fica em `https://fabio-ara.github.io/Um/`.

Se o endereço ou a configuração do servidor mudarem, atualize os metadados da conexão existente para que o ChatGPT use a versão nova.

## Seu primeiro estudo

Na primeira conversa, o ChatGPT identifica a obra ou o tema, as fontes autorizadas e os perfis envolvidos. Em seguida, publica o formulário e entrega o link para você responder no aplicativo. O link preserva o destino depois do login e exige o titular do perfil; não é preciso copiar identificadores técnicos.

O formulário é respondido uma pergunta por vez. Ao concluir o envio, volte ao ChatGPT e peça a continuação: não há um agente de fundo que perceba o envio sozinho. A segunda conversa retoma a sua submissão real e produz os complementos. A base já publicada continua acessível mesmo enquanto uma nova preparação é feita.

Dois pedidos naturais para começar:

- “Quero preparar um estudo para mim sobre [obra ou tema].”
- “Já respondi ao formulário. Retome minhas respostas e continue a preparação.”

## Conta e recuperação

O login é por e-mail e senha. A conta existente do AraLearn compartilha a autenticação do Um. Se esquecer a senha, escolha **Recuperar acesso** na tela de Conta. O link enviado por e-mail abre o site do Um para escolher uma nova senha.

O serviço hospedado já envia os e-mails de confirmação e recuperação por SMTP configurado. Confirme o endereço pelo link recebido para concluir um novo cadastro; confira também a pasta de spam. Esses e-mails são distintos dos convites de perfil, que são compartilhados manualmente por quem prepara o estudo. Para criar seu próprio perfil, você não precisa de convite.

## Limites úteis

Servidores personalizados podem ser restringidos pela conta ou pelo espaço de trabalho no ChatGPT. O aplicativo não é um editor pedagógico nem traz IA em tempo real.
