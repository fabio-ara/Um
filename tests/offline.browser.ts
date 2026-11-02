import { expect, test, type Page } from "@playwright/test";

test('fila e projeção persistem atomicamente e repetição não reescreve a projeção',async({page})=>{
 await boot(page);
 const result=await page.evaluate(async()=>{
  const t=(window as any).__offlineTest,{openOffline}=await t.load(),s=await openOffline('atomic-account','atomic-profile');
  const op=t.operation('atomic-op','atomic-account','atomic-profile','note_save',{text:'original'});
  await s.enqueue(op,{'note:one':{text:'original'}});await s.enqueue(op,{'note:one':{text:'não deve substituir'}});
  let aborted=false;try{await s.enqueue({...op,id:'failed-op'},{'note:two':()=>{}});}catch{aborted=true;}
  const value={one:await s.record('note:one'),two:await s.record('note:two'),count:(await s.operations()).length,aborted};await s.clear();s.close();return value;
 });expect(result).toEqual({one:{text:'original'},two:null,count:1,aborted:true});
});

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const moduleUrl = "/src/web/offline.ts";
    const errorsUrl = "/src/errors.ts";
    const scope = window as unknown as Record<string, any>;
    scope.__offlineTest = {
      load: () => import(moduleUrl),
      loadErrors: () => import(errorsUrl),
      enc: (text: string) => new TextEncoder().encode(text),
      dec: (bytes: Uint8Array) => new TextDecoder().decode(bytes),
      receipt: (operationId: string) => ({
        operationId,
        status: "confirmed",
        result: null,
        committedAt: new Date().toISOString(),
      }),
      operation(
        id: string,
        accountId: string,
        profileId: string,
        task: string,
        args: Record<string, unknown> = {},
        state = "pending",
      ) {
        return { id, accountId, profileId, task, arguments: args, state, createdAt: new Date().toISOString() };
      },
      async manifest(
        projectId: string,
        revision: number,
        files: { path: string; text: string; offlineAllowed?: boolean }[],
        profileId: string | null = null,
      ) {
        const entries = [];
        for (const file of files) {
          const bytes = new TextEncoder().encode(file.text);
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          const sha256 = Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
          entries.push({
            path: file.path,
            sha256,
            bytes: bytes.byteLength,
            mediaType: "text/plain",
            offlineAllowed: file.offlineAllowed !== false,
          });
        }
        return {
          format: "um-package/1",
          projectId,
          revision,
          profileId,
          files: entries,
          sourceRevisions: {},
          publishedAt: new Date().toISOString(),
        };
      },
    };
  });
  await page.goto("/tests/browser-harness.html");
}

test("instalação atômica: hash ruim não troca head nem perde o pacote anterior", async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const H = (window as unknown as Record<string, any>).__offlineTest;
    const mod = await H.load();
    const account = `atomic-${crypto.randomUUID()}`;
    const profile = "p1";
    const store = await mod.openOffline(account, profile);
    await store.clear();

    const first = await H.manifest("proj", 1, [{ path: "assets/a.txt", text: "one" }]);
    await store.install(first, async () => H.enc("one"));

    const second = await H.manifest("proj", 2, [{ path: "assets/a.txt", text: "two" }]);
    let code = "";
    try {
      await store.install(second, async () => H.enc("bad"));
    } catch (error: any) {
      code = error?.code ?? String(error);
    }

    const pkg = await store.package("proj", false);
    const text = pkg ? H.dec(pkg.files["assets/a.txt"]) : null;
    store.close();
    return { code, revision: pkg?.manifest.revision ?? null, text, hasPackage: Boolean(pkg) };
  });

  expect(result.code).toBe("HASH_MISMATCH");
  expect(result.hasPackage).toBe(true);
  expect(result.revision).toBe(1);
  expect(result.text).toBe("one");
});

test("isolamento entre contas e perfis, inclusive operações e registros", async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const H = (window as unknown as Record<string, any>).__offlineTest;
    const mod = await H.load();
    const accountA = `iso-a-${crypto.randomUUID()}`;
    const accountB = `iso-b-${crypto.randomUUID()}`;

    const a1 = await mod.openOffline(accountA, "p1");
    const a2 = await mod.openOffline(accountA, "p2");
    const b1 = await mod.openOffline(accountB, "p1");

    const manifest = await H.manifest("proj", 1, [{ path: "a.txt", text: "alpha" }]);
    await a1.install(manifest, async () => H.enc("alpha"));

    await a1.putRecord("r", { owner: "a1" });
    await a2.putRecord("r", { owner: "a2" });
    await b1.putRecord("r", { owner: "b1" });
    await a1.enqueue(H.operation("op-1", accountA, "p1", "create"));

    const a1pkg = await a1.package("proj", false);
    const a2pkg = await a2.package("proj", false);
    const b1pkg = await b1.package("proj", false);
    const a1ops = await a1.operations();
    const a2ops = await a2.operations();
    const b1ops = await b1.operations();
    const a1rec = await a1.record("r");
    const a2rec = await a2.record("r");
    const b1rec = await b1.record("r");
    const out = {
      a1: a1pkg ? H.dec(a1pkg.files["a.txt"]) : null,
      a2: a2pkg,
      b1: b1pkg,
      a1ops: a1ops.length,
      a2ops: a2ops.length,
      b1ops: b1ops.length,
      a1rec,
      a2rec,
      b1rec,
    };
    a1.close();
    a2.close();
    b1.close();
    return out;
  });

  expect(result.a1).toBe("alpha");
  expect(result.a2).toBeNull();
  expect(result.b1).toBeNull();
  expect(result.a1ops).toBe(1);
  expect(result.a2ops).toBe(0);
  expect(result.b1ops).toBe(0);
  expect(result.a1rec).toEqual({ owner: "a1" });
  expect(result.a2rec).toEqual({ owner: "a2" });
  expect(result.b1rec).toEqual({ owner: "b1" });
});

test("dados sobrevivem a refresh e reabertura da conexão", async ({ page }) => {
  await boot(page);
  const account = await page.evaluate(async () => {
    const H = (window as unknown as Record<string, any>).__offlineTest;
    const mod = await H.load();
    const accountId = `persist-${crypto.randomUUID()}`;
    const store = await mod.openOffline(accountId, "p1");
    const manifest = await H.manifest("proj", 3, [{ path: "keep.txt", text: "persisted" }], "p1");
    await store.install(manifest, async () => H.enc("persisted"));
    await store.enqueue(H.operation("pending-1", accountId, "p1", "update"));
    await store.putRecord("draft", { title: "offline" });
    store.close();
    return accountId;
  });

  await page.reload();

  const result = await page.evaluate(async (accountId: string) => {
    const H = (window as unknown as Record<string, any>).__offlineTest;
    const mod = await H.load();
    const store = await mod.openOffline(accountId, "p1");
    const pkg = await store.package("proj", true);
    const ops = await store.operations();
    const draft = await store.record("draft");
    const common = await store.package("proj", false);
    store.close();
    return {
      text: pkg ? H.dec(pkg.files["keep.txt"]) : null,
      revision: pkg?.manifest.revision ?? null,
      ops: ops.map((op: any) => op.id),
      draft,
      common,
    };
  }, account);

  expect(result.text).toBe("persisted");
  expect(result.revision).toBe(3);
  expect(result.ops).toEqual(["pending-1"]);
  expect(result.draft).toEqual({ title: "offline" });
  expect(result.common).toBeNull();
});

test("perda de resposta: recibo recuperado confirma sem segundo efeito", async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const H = (window as unknown as Record<string, any>).__offlineTest;
    const mod = await H.load();
    const account = `lost-${crypto.randomUUID()}`;
    const profile = "p1";
    const store = await mod.openOffline(account, profile);
    await store.enqueue(H.operation("op-1", account, profile, "create", { n: 1 }));

    let effects = 0;
    let secondSends = 0;
    let recoveries = 0;
    const applied = new Set<string>();

    const sendLost = async (operation: any) => {
      effects += 1;
      applied.add(operation.id);
      throw new TypeError("response lost");
    };
    const recover = async (id: string) => {
      recoveries += 1;
      return applied.has(id) ? H.receipt(id) : null;
    };

    await store.sync(sendLost, recover);
    const afterLoss = (await store.operations()).map((op: any) => op.state);

    const sendAgain = async (operation: any) => {
      secondSends += 1;
      effects += 1;
      return H.receipt(operation.id);
    };
    await store.sync(sendAgain, recover);
    const afterRecovery = (await store.operations()).map((op: any) => op.state);

    await store.sync(sendAgain, recover);
    const afterThird = (await store.operations()).map((op: any) => op.state);

    store.close();
    return { afterLoss, afterRecovery, afterThird, effects, secondSends, recoveries };
  });

  expect(result.afterLoss).toEqual(["uncertain"]);
  expect(result.afterRecovery).toEqual(["confirmed"]);
  expect(result.afterThird).toEqual(["confirmed"]);
  expect(result.effects).toBe(1);
  expect(result.secondSends).toBe(0);
  expect(result.recoveries).toBe(1);
});

test("sync repetido não reenvia confirmado e enqueue repetido conserva estado", async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const H = (window as unknown as Record<string, any>).__offlineTest;
    const mod = await H.load();
    const account = `repeat-${crypto.randomUUID()}`;
    const profile = "p1";
    const store = await mod.openOffline(account, profile);
    const operation = H.operation("op-1", account, profile, "create", { n: 1 });
    await store.enqueue(operation);

    let sends = 0;
    const send = async (op: any) => {
      sends += 1;
      return H.receipt(op.id);
    };
    const recover = async () => null;

    await store.sync(send, recover);
    await store.sync(send, recover);
    await store.enqueue(operation);

    let conflictCode = "";
    try {
      await store.enqueue({ ...operation, arguments: { n: 2 } });
    } catch (error: any) {
      conflictCode = error?.code ?? String(error);
    }

    const ops = (await store.operations()).map((op: any) => ({ id: op.id, state: op.state }));
    store.close();
    return { sends, conflictCode, ops };
  });

  expect(result.sends).toBe(1);
  expect(result.conflictCode).toBe("OPERATION_CONFLICT");
  expect(result.ops).toEqual([{ id: "op-1", state: "confirmed" }]);
});

test("AppError CONFLICT vira conflict, NOT_FOUND vira error e não são reenviados", async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const H = (window as unknown as Record<string, any>).__offlineTest;
    const mod = await H.load();
    const errors = await H.loadErrors();
    const account = `receipt-${crypto.randomUUID()}`;
    const profile = "p1";
    const store = await mod.openOffline(account, profile);
    await store.enqueue(H.operation("a", account, profile, "create"));
    await store.enqueue(H.operation("b", account, profile, "create"));

    let sends = 0;
    const send = async (op: any) => {
      sends += 1;
      if (op.id === "a") throw new errors.AppError("CONFLICT", "conflict", 409);
      throw new errors.AppError("NOT_FOUND", "missing", 404);
    };
    const recover = async () => null;

    await store.sync(send, recover);
    const first = (await store.operations()).map((op: any) => [op.id, op.state]);
    await store.sync(send, recover);
    const second = (await store.operations()).map((op: any) => [op.id, op.state]);
    store.close();
    return { sends, first, second };
  });

  expect(result.sends).toBe(2);
  expect(result.first).toEqual([
    ["a", "conflict"],
    ["b", "error"],
  ]);
  expect(result.second).toEqual(result.first);
});

test("clearAccount limpa todas as partições da conta e preserva outra conta", async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const H = (window as unknown as Record<string, any>).__offlineTest;
    const mod = await H.load();
    const accountA = `clear-a-${crypto.randomUUID()}`;
    const accountB = `clear-b-${crypto.randomUUID()}`;

    const a1 = await mod.openOffline(accountA, "p1");
    const a2 = await mod.openOffline(accountA, "p2");
    const b1 = await mod.openOffline(accountB, "p1");

    const manA = await H.manifest("proj", 1, [{ path: "a.txt", text: "a" }]);
    const manB = await H.manifest("proj", 1, [{ path: "b.txt", text: "b" }]);
    await a1.install(manA, async () => H.enc("a"));
    await a2.install(manA, async () => H.enc("a"));
    await b1.install(manB, async () => H.enc("b"));
    await a1.putRecord("r", { a: 1 });
    await a2.putRecord("r", { a: 2 });
    await b1.putRecord("r", { b: 1 });
    await a1.enqueue(H.operation("a-op", accountA, "p1", "x"));
    a1.close();
    a2.close();
    b1.close();

    await mod.clearAccount(accountA);

    const a1b = await mod.openOffline(accountA, "p1");
    const a2b = await mod.openOffline(accountA, "p2");
    const b1b = await mod.openOffline(accountB, "p1");
    const out = {
      a1pkg: await a1b.package("proj", false),
      a2pkg: await a2b.package("proj", false),
      a1rec: await a1b.record("r"),
      a2rec: await a2b.record("r"),
      a1ops: (await a1b.operations()).length,
      b1pkg: await b1b.package("proj", false),
      b1rec: await b1b.record("r"),
    };
    a1b.close();
    a2b.close();
    b1b.close();
    return out;
  });

  expect(result.a1pkg).toBeNull();
  expect(result.a2pkg).toBeNull();
  expect(result.a1rec).toBeNull();
  expect(result.a2rec).toBeNull();
  expect(result.a1ops).toBe(0);
  expect(result.b1pkg).not.toBeNull();
  expect(result.b1rec).toEqual({ b: 1 });
});
