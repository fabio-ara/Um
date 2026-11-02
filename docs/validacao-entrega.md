# Validação e entrega

O workflow `Validate Um` verifica contratos, testes determinísticos, build web e
compilação Android debug. Usa Actions fixadas por SHA, token somente de leitura e
nenhuma credencial de produção. Push de trabalho não publica site, backend ou APK.
Uma compilação debug não comprova assinatura de release nem comportamento Android.

Integração, Storage, navegador, preservação e cliente real têm provas separadas.
No ambiente local descartável documentado em `backend.md`, selecione primeiro a
família alterada. Exemplos:

```sh
npx tsx --env-file-if-exists=.env --test tests/parameters.integration.test.ts
npx tsx --env-file-if-exists=.env node_modules/@playwright/test/cli.js test tests/reader-update.browser.ts tests/update-races.browser.ts
```

O gate final registra SHA/árvore limpa, revisão independente resolvida, comandos,
ambiente, resultados e limitações. A integração completa usa `npm test`; as provas
de demonstração e Storage exigem `UM_DEMO_PROOF=1` e `UM_STORAGE_PROOF=1`, com seus
serviços e dados sintéticos preparados. Skips não certificam esses critérios.
O Chrome usa o backend real local, e `scripts/prove-offline-local.ts` confere o
shell de produção, Service Worker e IndexedDB em processos distintos.

Publicar requer a mesma candidata em `UM_CANDIDATE_SHA`, backup/restauração e
ensaio aditivo, verificação dos acessos anteriores, backend HTTPS e configuração
pública correspondente. `stage-edge.ts --release` e a tarefa Android release
recusam árvore suja ou SHA diferente. A assinatura deve ser própria do Um.
Somente depois dessas condições são executados deploy, Pages e release.

Após a promoção, conferir bytes/revisão servidos, isolamento e direitos no host,
ChatGPT Web com anexo real e APK assinado instalado. OAuth/HTTP local, SDK,
inspeção automática de acessibilidade e debug não substituem essas provas.
Uma edição material retorna à estabilização e invalida somente a evidência afetada.

O workflow `Publish reviewed Um candidate` é exclusivamente manual. Depois dos
gates, integre a candidata em `main` sem trocar seus bytes; confira o SHA resultante
e a correspondência da árvore. Configure Pages com origem GitHub Actions e a
variável pública `UM_API_ORIGIN` com o backend HTTPS já verificado. O dispatch recebe
o SHA completo e recusa qualquer diferença em `main`. `build-identity.json` permite
conferir a revisão e o endpoint servidos, também presentes no shell Android.
Não despache esse workflow enquanto houver revisão ou prova obrigatória pendente.

Android usa Java 17 e SDK 36. `android/gradlew :app:assembleDebug` gera somente o
aplicativo isolado `com.fabioara.um.debug`. Para release, além de candidata limpa e
`VITE_API_ORIGIN` HTTPS, forneça por ambiente privado `UM_ANDROID_KEYSTORE_PATH`,
`UM_ANDROID_KEYSTORE_PASSWORD`, `UM_ANDROID_KEY_ALIAS` e `UM_ANDROID_KEY_PASSWORD`.
Use `:app:assembleRelease`, confira a assinatura com `apksigner verify --print-certs`
e instale o APK resultante para a prova real. A tarefa refaz o gate mesmo com cache
Gradle. Nunca reutilize a chave de outro produto nem publique chaves/senhas no Git.
