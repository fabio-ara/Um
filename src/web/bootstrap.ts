import './style.css';
// Configuration is obtained before Auth starts. A first open without the service
// must remain understandable even when there is no cached public configuration.
try { await import('./main.ts'); }
catch {
 const root=document.getElementById('app')!;
 root.innerHTML='<div class="shell"><main id="main" tabindex="-1"><section class="card" role="alert"><h1>Não foi possível abrir o Um</h1><p>Confira a conexão e tente novamente. O serviço precisa estar disponível na primeira abertura deste dispositivo.</p><button type="button" class="control" id="retry-open">Tentar novamente</button></section></main></div>';
 root.querySelector('#retry-open')!.addEventListener('click',()=>location.reload());
 root.querySelector<HTMLElement>('main')!.focus();
}
