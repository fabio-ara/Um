# Dados pessoais, exportação e exclusão

O perfil pertence ao titular que aceitou o convite. Antes da associação, seu
criador pode editá-lo, exportá-lo e excluí-lo. Depois da associação, o titular
controla a exportação, a exclusão e a retirada do acesso do criador. Nome ou
apelido não autentica ninguém. Excluir um perfil do Um não exclui a conta de
autenticação compartilhada nem dados dos outros produtos.

A exportação possui um índice e partes paginadas: participações, formulários e
suas versões, respostas enviadas, notas, práticas, estado, apoios, justificativas,
comentários compartilhados, observações e arquivos pessoais. Os arquivos são
obtidos separadamente, com verificação de integridade e dos direitos registrados.
Um material permitido apenas para consulta não é oferecido como arquivo exportável.
Se os dados mudarem durante a obtenção das partes, a interface solicita novo índice.

Excluir o perfil retira imediatamente o acesso aos seus dados e derivados no
serviço. As contribuições compartilhadas registram o perfil de origem: comentários
são substituídos por um aviso sem texto, passagem ou identificação do autor, para
preservar respostas alheias; observações do perfil são removidas. A exclusão de um
comentário segue a mesma regra. Uma origem histórica ausente nunca é inferida por
nome, texto ou participação atual.

A remoção dos arquivos físicos usa uma fila durável. Falha de rede ou armazenamento
mantém a remoção pendente, que é retomada com conexão ou pelo controle da Conta.
Uploads sem registro após uma interrupção são considerados para coleta depois de
24 horas. A verificação considera registros existentes mesmo quando o antigo
criador já não pode vê-los. Recibos de operações conservam identificadores e
revisões para evitar duplicidade; não conservam o texto das notas ou comentários.

O aplicativo isola os dados locais por conta e perfil. Com conexão, a confirmação
de perda de acesso limpa a partição correspondente. Uma cópia já exportada para
fora do Um ou um dispositivo ainda desconectado não pode ser recolhido à distância.

As provas automatizadas atuais cobrem banco, autenticação, arquivos e navegador
locais. A remoção via Storage hospedado e a limpeza dos clientes na implantação
final exigem a prova própria de entrega; este documento não as certifica.
