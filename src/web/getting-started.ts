import {mcpUrl} from './api.ts';
import {escapeHtml as esc,iconButton} from './dom.ts';

export function gettingStarted(createProfile=false,expanded=!createProfile){
 return `<section class="card"><h2>${createProfile?'Comece seu estudo':'Preparar um estudo'}</h2><p>O ChatGPT prepara os estudos com o Um conectado. Aqui você responde à preparação, lê, pratica e guarda suas notas.</p>${createProfile?`<p>Vai estudar por conta própria? Crie seu perfil; você não precisa de convite.</p><div class="submit-row">${iconButton('account-add','Criar meu perfil','create-self')}</div>`:''}<details ${expanded?'open':''}><summary>Conectar o Um ao ChatGPT</summary><ol><li>No ChatGPT, abra Plugins, escolha + e “Adicionar servidor MCP personalizado”.</li><li>Use o nome Um e o endereço abaixo, com autenticação OAuth. Entre com a mesma conta usada aqui e autorize leitura e escrita.</li><li>Instale o plugin e selecione @Um em uma conversa. Peça: “Quero preparar um estudo para mim sobre…” e indique a obra ou o tema.</li></ol><label class="field">Endereço do servidor MCP<input readonly value="${esc(mcpUrl)}"></label><div class="submit-row">${iconButton('copy','Copiar endereço do Um','copy-mcp')}</div><p class="muted">A disponibilidade de servidores personalizados depende da sua conta e das regras do espaço de trabalho no ChatGPT.</p><p>Quando o assistente entregar o link da preparação, responda aqui e volte à conversa para pedir que continue. O envio não inicia o ChatGPT automaticamente.</p></details><p class="muted">Se outra pessoa está preparando o estudo para você, ela gera e compartilha um convite. O Um não envia esses convites automaticamente por e-mail. Aceite o código na sua Conta.</p></section>`;
}

export async function allPages(api:(task:string,args:Record<string,unknown>)=>Promise<any>,task:'profile_list'|'project_list'){
 const items:any[]=[];
 for(let offset=0;;offset+=50){const page=await api(task,{offset,limit:50});items.push(...page.items);if(page.items.length<50)return items;}
}
