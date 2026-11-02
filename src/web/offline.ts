import type { FileEntry, Manifest, QueuedOperation, Receipt } from "../contracts.ts";
import { AppError } from "../errors.ts";

const DB_NAME = "um-offline-v1";
const DB_VERSION = 1;
const STORES = ["packages", "heads", "operations", "records"] as const;
type StoreName = (typeof STORES)[number];

const FORMAT = "um-package/1";
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 512;
const MAX_PATH_LENGTH = 1024;
const STALE_CLAIM_MS = 120_000;

const OPERATION_STATES = new Set(["local", "pending", "confirmed", "error", "conflict", "uncertain"]);

type Scope = "common" | "personal";

type OperationRow = QueuedOperation & {
  key: string;
  claimToken?: string;
  claimedAt?: number;
};

interface StoredPackage {
  key: string;
  accountId: string;
  profileId: string;
  scope: Scope;
  projectId: string;
  manifest: Manifest;
  files: Record<string, ArrayBuffer>;
}

interface StoredHead {
  key: string;
  scope: Scope;
  projectId: string;
  revision: number;
  installedAt: number;
}

export interface OfflineStore {
  install(manifest: Manifest, fetchFile: (file: FileEntry) => Promise<Uint8Array>): Promise<void>;
  installStudy(manifests:Manifest[],fetchFile:(file:FileEntry)=>Promise<Uint8Array>):Promise<void>;
  package(projectId: string, personal: boolean): Promise<{ manifest: Manifest; files: Record<string, Uint8Array> } | null>;
  enqueue(operation: QueuedOperation, records?: Record<string,unknown>): Promise<void>;
  operations(): Promise<QueuedOperation[]>;
  sync(
    send: (operation: QueuedOperation) => Promise<Receipt>,
    recover: (id: string) => Promise<Receipt | null>,
  ): Promise<void>;
  putRecord(id: string, value: unknown): Promise<void>;
  record(id: string): Promise<unknown | null>;
  clear(): Promise<void>;
  discardPreparedReads(): Promise<void>;
  evictPackage(projectId:string,personal:boolean): Promise<void>;
  close(): void;
}

const locks = new Map<string, Promise<void>>();

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const guard = run.then(
    () => undefined,
    () => undefined,
  );
  locks.set(key, guard);
  guard.then(() => {
    if (locks.get(key) === guard) locks.delete(key);
  });
  return run;
}

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

function partitionPrefix(accountId: string, profileId: string): string {
  return `a/${encodePart(accountId)}/p/${encodePart(profileId)}/`;
}

function accountPrefix(accountId: string): string {
  return `a/${encodePart(accountId)}/`;
}

function rangeForPrefix(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound(prefix, `${prefix}\uffff`);
}

function fail(code: string, message: string, status = 400): never {
  throw new AppError(code, message, status);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function isSafePath(value: unknown): value is string {
  if (!isNonEmptyString(value) || value.length > MAX_PATH_LENGTH) return false;
  if (value.startsWith("/") || value.includes("\\")) return false;
  if (/^[a-zA-Z]:/.test(value)) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.includes("://")) return false;
  const parts = value.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== ".." && part.length <= 255);
}

function sha256Hex(bytes: Uint8Array): Promise<string> {
  return crypto.subtle.digest("SHA-256", new Uint8Array(bytes)).then((digest) => {
    const view = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < view.length; i += 1) hex += view[i].toString(16).padStart(2, "0");
    return hex;
  });
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  fail("INVALID_FILE_BYTES", "fetchFile must return Uint8Array");
}

function isTerminal(state: string): boolean {
  return state === "confirmed" || state === "error" || state === "conflict";
}

function isStale(row: OperationRow, now: number): boolean {
  return typeof row.claimedAt !== "number" || now - row.claimedAt >= STALE_CLAIM_MS;
}

function isConfirmedReceipt(receipt: Receipt | null, id: string): receipt is Receipt {
  return Boolean(receipt && receipt.operationId === id && receipt.status === "confirmed");
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const value = error as Record<string, unknown> | null;
  return typeof value?.message === "string" && value.message ? value.message : String(error);
}

function classifyFailure(error: unknown): "conflict" | "error" | "uncertain" {
  const value = error as Record<string, unknown> | null;
  const code = typeof value?.code === "string" ? value.code : undefined;
  const status = typeof value?.status === "number" ? value.status : undefined;
  if (code === "CONFLICT" || status === 409) return "conflict";
  if (code === "NOT_FOUND" || status && status>=400&&status<500&&status!==429) return "error";
  return "uncertain";
}

function publicOperation(row: OperationRow): QueuedOperation {
  const operation: QueuedOperation = {
    id: row.id,
    accountId: row.accountId,
    profileId: row.profileId,
    task: row.task,
    arguments: row.arguments,
    state: row.state,
    createdAt: row.createdAt,
  };
  if (typeof row.error === "string") operation.error = row.error;
  return operation;
}

function sameIntent(a: Pick<QueuedOperation, "task" | "arguments">, b: Pick<QueuedOperation, "task" | "arguments">): boolean {
  return a.task === b.task && JSON.stringify(a.arguments) === JSON.stringify(b.arguments);
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") fail("IDB_UNAVAILABLE", "IndexedDB is not available", 500);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new AppError("IDB_OPEN_FAILED", "could not open IndexedDB", 500));
    request.onblocked = () => reject(new AppError("IDB_BLOCKED", "IndexedDB upgrade blocked", 500));
  });
}

class OfflineStoreImpl implements OfflineStore {
  private readonly db: IDBDatabase;
  private readonly accountId: string;
  private readonly profileId: string;
  private readonly prefix: string;
  private closed = false;

  constructor(db: IDBDatabase, accountId: string, profileId: string) {
    this.db = db;
    this.accountId = accountId;
    this.profileId = profileId;
    this.prefix = partitionPrefix(accountId, profileId);
  }

  private assertOpen(): void {
    if (this.closed) fail("STORE_CLOSED", "offline store is closed", 409);
  }

  private packageKey(scope: Scope, projectId: string): string {
    return `${this.prefix}k/${scope}/${encodePart(projectId)}`;
  }

  private headKey(scope: Scope, projectId: string): string {
    return `${this.prefix}h/${scope}/${encodePart(projectId)}`;
  }

  private operationKey(id: string): string {
    return `${this.prefix}o/${encodePart(id)}`;
  }

  private recordKey(id: string): string {
    return `${this.prefix}r/${encodePart(id)}`;
  }

  private transaction<T>(
    stores: StoreName[],
    mode: IDBTransactionMode,
    run: (tx: IDBTransaction) => T,
  ): Promise<T> {
    this.assertOpen();
    return new Promise<T>((resolve, reject) => {
      let result!: T;
      const tx = this.db.transaction(stores, mode);
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new AppError("TX_ABORTED", "transaction aborted", 500));
      tx.onerror = () => reject(tx.error ?? new AppError("TX_FAILED", "transaction failed", 500));
      try {
        result = run(tx);
      } catch (error) {
        try {
          tx.abort();
        } catch {
          // ignore
        }
        reject(error);
      }
    });
  }

  private getOne(store: StoreName, key: string): Promise<unknown | null> {
    this.assertOpen();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, "readonly");
      const request = tx.objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new AppError("READ_FAILED", "read failed", 500));
    });
  }

  private getAll(store: StoreName): Promise<Record<string, unknown>[]> {
    this.assertOpen();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, "readonly");
      const request = tx.objectStore(store).getAll(rangeForPrefix(this.prefix));
      request.onsuccess = () => resolve((request.result ?? []) as Record<string, unknown>[]);
      request.onerror = () => reject(request.error ?? new AppError("READ_FAILED", "read failed", 500));
    });
  }

  private getHeadAndPackage(
    headKey: string,
    packageKey: string,
  ): Promise<{ head: StoredHead | null; pkg: StoredPackage | null }> {
    this.assertOpen();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["heads", "packages"], "readonly");
      const headRequest = tx.objectStore("heads").get(headKey);
      headRequest.onsuccess = () => {
        const head = (headRequest.result ?? null) as StoredHead | null;
        if (!head) {
          resolve({ head: null, pkg: null });
          return;
        }
        const packageRequest = tx.objectStore("packages").get(packageKey);
        packageRequest.onsuccess = () =>
          resolve({ head, pkg: (packageRequest.result ?? null) as StoredPackage | null });
        packageRequest.onerror = () =>
          reject(packageRequest.error ?? new AppError("READ_FAILED", "read failed", 500));
      };
      headRequest.onerror = () => reject(headRequest.error ?? new AppError("READ_FAILED", "read failed", 500));
    });
  }

  private prepare = async (manifest: Manifest, fetchFile: (file: FileEntry) => Promise<Uint8Array>): Promise<{pkg:StoredPackage;head:StoredHead}> => {
    this.assertOpen();
    const raw = manifest as unknown as Record<string, unknown>;
    if (!isPlainObject(raw)) fail("INVALID_MANIFEST", "manifest must be an object");
    if (raw.format !== FORMAT) fail("INVALID_FORMAT", `manifest format must be ${FORMAT}`);
    if (!isNonEmptyString(raw.projectId)) fail("INVALID_MANIFEST", "manifest projectId is required");
    if (!Number.isSafeInteger(raw.revision) || (raw.revision as number) < 1) {
      fail("INVALID_REVISION", "manifest revision must be a positive integer");
    }
    const manifestProfileId = raw.profileId;
    if (manifestProfileId !== null && manifestProfileId !== this.profileId) {
      fail("PROFILE_MISMATCH", "manifest belongs to another profile", 403);
    }
    if (!Array.isArray(raw.files)) fail("INVALID_MANIFEST", "manifest files are required");
    if (raw.files.length > MAX_FILES) fail("TOO_MANY_FILES", "manifest exceeds file limit");
    if (!isPlainObject(raw.sourceRevisions)) fail("INVALID_MANIFEST", "manifest sourceRevisions are required");
    if (!isNonEmptyString(raw.publishedAt)) fail("INVALID_MANIFEST", "manifest publishedAt is required");
    if (typeof fetchFile !== "function") fail("INVALID_FETCHER", "fetchFile is required");

    const scope: Scope = manifestProfileId === null ? "common" : "personal";
    const seen = new Set<string>();
    const allowed: FileEntry[] = [];
    let total = 0;

    for (const candidate of raw.files) {
      if (!isPlainObject(candidate)) fail("INVALID_MANIFEST", "invalid file entry");
      const file = candidate as unknown as FileEntry;
      if (!isSafePath(file.path)) fail("UNSAFE_PATH", "unsafe file path");
      if (seen.has(file.path)) fail("DUPLICATE_PATH", "duplicate file path");
      seen.add(file.path);
      if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_FILE_BYTES) {
        fail("INVALID_SIZE", "invalid file size");
      }
      if (!isHexSha256(file.sha256)) fail("INVALID_HASH", "invalid file hash");
      if (!isNonEmptyString(file.mediaType)) fail("INVALID_MEDIA_TYPE", "invalid file media type");
      if (typeof file.offlineAllowed !== "boolean") fail("INVALID_MANIFEST", "offlineAllowed is required");
      if (!file.offlineAllowed) continue;
      total += file.bytes;
      if (total > MAX_TOTAL_BYTES) fail("TOO_LARGE", "offline package exceeds size limit");
      allowed.push(file);
    }

    const verified: { file: FileEntry; bytes: Uint8Array }[] = [];
    for (const file of allowed) {
      const bytes = toBytes(await fetchFile(file));
      if (bytes.byteLength !== file.bytes) {
        fail("SIZE_MISMATCH", `size mismatch for ${file.path}`);
      }
      const actual = await sha256Hex(bytes);
      if (actual !== file.sha256.toLowerCase()) {
        fail("HASH_MISMATCH", `hash mismatch for ${file.path}`);
      }
      verified.push({ file, bytes });
    }

    const allowedPaths = new Set(allowed.map((file) => file.path));
    const storedManifest: Manifest = {
      ...(raw as unknown as Manifest),
      files: (raw.files as FileEntry[]).filter((file) => allowedPaths.has(file.path)),
    };
    const files: Record<string, ArrayBuffer> = {};
    for (const item of verified) {
      files[item.file.path] = new Uint8Array(item.bytes).buffer as ArrayBuffer;
    }

    const pkg: StoredPackage = {
      key: this.packageKey(scope, raw.projectId),
      accountId: this.accountId,
      profileId: this.profileId,
      scope,
      projectId: raw.projectId,
      manifest: storedManifest,
      files,
    };
    const head: StoredHead = {
      key: this.headKey(scope, raw.projectId),
      scope,
      projectId: raw.projectId,
      revision: raw.revision as number,
      installedAt: Date.now(),
    };

    return {pkg,head};
  };

  install = async (manifest:Manifest,fetchFile:(file:FileEntry)=>Promise<Uint8Array>):Promise<void> => {
    const prepared=await this.prepare(manifest,fetchFile);
    await this.transaction(['packages','heads'],'readwrite',tx=>{tx.objectStore('packages').put(prepared.pkg);tx.objectStore('heads').put(prepared.head);});
  };

  installStudy = async (manifests:Manifest[],fetchFile:(file:FileEntry)=>Promise<Uint8Array>):Promise<void> => {
    const common=manifests.find(m=>m.profileId===null),personal=manifests.find(m=>m.profileId!==null);
    if(!common||manifests.length>2||manifests.filter(m=>m.profileId===null).length!==1||personal&&((personal as Manifest&{baseRevision:number}).baseRevision!==common.revision||personal.projectId!==common.projectId))fail('STALE_BASE','Os apoios ainda não correspondem à base atual.',409);
    const prepared:{pkg:StoredPackage;head:StoredHead}[]=[];
    for(const manifest of manifests)prepared.push(await this.prepare(manifest,fetchFile));
    // No head is changed until every permitted byte in both packages verifies.
    await this.transaction(['packages','heads'],'readwrite',tx=>{
      for(const {pkg,head}of prepared){tx.objectStore('packages').put(pkg);tx.objectStore('heads').put(head);}
      if(!personal){tx.objectStore('packages').delete(this.packageKey('personal',common.projectId));tx.objectStore('heads').delete(this.headKey('personal',common.projectId));}
    });
  };

  package = async (
    projectId: string,
    personal: boolean,
  ): Promise<{ manifest: Manifest; files: Record<string, Uint8Array> } | null> => {
    this.assertOpen();
    if (!isNonEmptyString(projectId)) fail("INVALID_PROJECT", "projectId is required");
    const scope: Scope = personal ? "personal" : "common";
    const { head, pkg } = await this.getHeadAndPackage(
      this.headKey(scope, projectId),
      this.packageKey(scope, projectId),
    );
    if (!head || !pkg) return null;
    if (pkg.projectId !== projectId || pkg.scope !== scope) return null;
    if (head.revision !== pkg.manifest.revision) return null;
    const files: Record<string, Uint8Array> = {};
    for (const entry of pkg.manifest.files) {
      const raw = pkg.files[entry.path];
      if (!raw) return null;
      const bytes = toBytes(raw);
      if (bytes.byteLength !== entry.bytes) return null;
      files[entry.path] = new Uint8Array(bytes);
    }
    return { manifest: pkg.manifest, files };
  };

  enqueue = async (operation: QueuedOperation, records:Record<string,unknown>={}): Promise<void> => {
    this.assertOpen();
    const raw = operation as unknown as Record<string, unknown>;
    if (!isPlainObject(raw)) fail("INVALID_OPERATION", "operation must be an object");
    if (!isNonEmptyString(raw.id)) fail("INVALID_OPERATION", "operation id is required");
    if (raw.accountId !== this.accountId) fail("ACCOUNT_MISMATCH", "operation belongs to another account", 403);
    if (raw.profileId !== this.profileId) fail("PROFILE_MISMATCH", "operation belongs to another profile", 403);
    if (!isNonEmptyString(raw.task)) fail("INVALID_OPERATION", "operation task is required");
    if (!isPlainObject(raw.arguments)) fail("INVALID_OPERATION", "operation arguments are required");
    if (!isNonEmptyString(raw.createdAt)) fail("INVALID_OPERATION", "operation createdAt is required");
    if (typeof raw.state !== "string" || !OPERATION_STATES.has(raw.state)) {
      fail("INVALID_OPERATION", "operation state is invalid");
    }
    if (raw.error !== undefined && typeof raw.error !== "string") {
      fail("INVALID_OPERATION", "operation error must be a string");
    }

    const id = raw.id;
    const key = this.operationKey(id);
    const next: OperationRow = {
      key,
      id,
      accountId: this.accountId,
      profileId: this.profileId,
      task: raw.task,
      arguments: raw.arguments,
      state: raw.state as QueuedOperation["state"],
      createdAt: raw.createdAt,
    };
    if (typeof raw.error === "string") next.error = raw.error;
    const intent = { task: next.task, arguments: next.arguments };

    await withLock(
      this.prefix,
      () =>
        new Promise<void>((resolve, reject) => {
          const tx = this.db.transaction(["operations","records"], "readwrite");
          const store = tx.objectStore("operations");
          let conflict: AppError | null = null;
          const request = store.get(key);
          request.onsuccess = () => {
            const existing = request.result as OperationRow | undefined;
            if (!existing) {
              store.put(next);
              for(const [recordId,value]of Object.entries(records))tx.objectStore('records').put({key:this.recordKey(recordId),id:recordId,value});
              return;
            }
            if (!sameIntent(existing, intent)) {
              conflict = new AppError("OPERATION_CONFLICT", "operation id reused with different intent", 409);
              try {
                tx.abort();
              } catch {
                // ignore
              }
              return;
            }
            // Same intent: keep the stored state, including confirmed/error.
          };
          request.onerror = () => {
            try {
              tx.abort();
            } catch {
              // ignore
            }
            reject(request.error ?? new AppError("ENQUEUE_FAILED", "enqueue failed", 500));
          };
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(conflict ?? tx.error ?? new AppError("TX_ABORTED", "transaction aborted", 500));
          tx.onerror = () => {
            if (!conflict) reject(tx.error ?? new AppError("TX_FAILED", "transaction failed", 500));
          };
        }),
    );
  };

  operations = async (): Promise<QueuedOperation[]> => {
    this.assertOpen();
    return withLock(this.prefix, async () => {
      const rows = (await this.getAll("operations")) as unknown as OperationRow[];
      rows.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||Number(a.arguments.expectedRevision||0)-Number(b.arguments.expectedRevision||0)||a.id.localeCompare(b.id));
      return rows.map(publicOperation);
    });
  };

  private claim(
    key: string,
    token: string,
    now: number,
  ): Promise<{ status: "claimed" | "busy" | "done"; previouslyClaimed: boolean }> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("operations", "readwrite");
      const store = tx.objectStore("operations");
      let outcome: { status: "claimed" | "busy" | "done"; previouslyClaimed: boolean } = {
        status: "busy",
        previouslyClaimed: false,
      };
      const request = store.get(key);
      request.onsuccess = () => {
        const current = request.result as OperationRow | undefined;
        if (!current) {
          outcome = { status: "done", previouslyClaimed: false };
          return;
        }
        if (isTerminal(current.state)) {
          outcome = { status: "done", previouslyClaimed: false };
          return;
        }
        const previouslyClaimed = typeof current.claimToken === "string";
        if (previouslyClaimed && !isStale(current, now)) {
          outcome = { status: "busy", previouslyClaimed: true };
          return;
        }
        store.put({ ...current, claimToken: token, claimedAt: now });
        outcome = { status: "claimed", previouslyClaimed };
      };
      request.onerror = () => {
        try {
          tx.abort();
        } catch {
          // ignore
        }
        reject(request.error ?? new AppError("CLAIM_FAILED", "claim failed", 500));
      };
      tx.oncomplete = () => resolve(outcome);
      tx.onabort = () => reject(tx.error ?? new AppError("TX_ABORTED", "transaction aborted", 500));
      tx.onerror = () => reject(tx.error ?? new AppError("TX_FAILED", "transaction failed", 500));
    });
  }

  private settle(
    key: string,
    token: string,
    state: QueuedOperation["state"],
    error?: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("operations", "readwrite");
      const store = tx.objectStore("operations");
      const request = store.get(key);
      request.onsuccess = () => {
        const current = request.result as OperationRow | undefined;
        if (!current || current.claimToken !== token) return;
        const {
          claimToken: _claimToken,
          claimedAt: _claimedAt,
          ...rest
        } = current;
        const next: OperationRow = { ...rest, state };
        if (error !== undefined) next.error = error;
        else delete next.error;
        store.put(next);
      };
      request.onerror = () => {
        try {
          tx.abort();
        } catch {
          // ignore
        }
        reject(request.error ?? new AppError("SETTLE_FAILED", "settle failed", 500));
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new AppError("TX_ABORTED", "transaction aborted", 500));
      tx.onerror = () => reject(tx.error ?? new AppError("TX_FAILED", "transaction failed", 500));
    });
  }

  sync = async (
    send: (operation: QueuedOperation) => Promise<Receipt>,
    recover: (id: string) => Promise<Receipt | null>,
  ): Promise<void> => {
    this.assertOpen();
    if (typeof send !== "function" || typeof recover !== "function") {
      fail("INVALID_ARGUMENT", "send and recover are required");
    }
    await withLock(this.prefix, async () => {
      const rows = (await this.getAll("operations")) as unknown as OperationRow[];
      for (const row of rows) {
        if (isTerminal(row.state)) continue;
        if (typeof row.claimToken === "string" && !isStale(row, Date.now())) continue;

        const id = row.id;
        const key = this.operationKey(id);
        const token =
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        const claim = await this.claim(key, token, Date.now());
        if (claim.status !== "claimed") continue;

        const mustRecoverFirst = row.state === "uncertain" || claim.previouslyClaimed;
        let failure: unknown = null;

        try {
          if (mustRecoverFirst) {
            const recovered = await recover(id);
            if (recovered !== null) {
              if (!isConfirmedReceipt(recovered, id)) {
                fail("BAD_RECEIPT", "recovered receipt does not confirm the operation", 502);
              }
              await this.settle(key, token, "confirmed");
              continue;
            }
          }
          const receipt = await send(publicOperation(row));
          if (!isConfirmedReceipt(receipt, id)) {
            fail("BAD_RECEIPT", "receipt does not confirm the operation", 502);
          }
        } catch (error) {
          failure = error;
        }

        if (failure !== null) {
          await this.settle(key, token, classifyFailure(failure), messageOf(failure));
          continue;
        }
        await this.settle(key, token, "confirmed");
      }
    });
  };

  putRecord = async (id: string, value: unknown): Promise<void> => {
    this.assertOpen();
    if (!isNonEmptyString(id)) fail("INVALID_RECORD_ID", "record id is required");
    const key = this.recordKey(id);
    await withLock(this.prefix, () =>
      this.transaction(["records"], "readwrite", (tx) => {
        tx.objectStore("records").put({ key, id, value });
      }),
    );
  };

  record = async (id: string): Promise<unknown | null> => {
    this.assertOpen();
    if (!isNonEmptyString(id)) fail("INVALID_RECORD_ID", "record id is required");
    const row = (await this.getOne("records", this.recordKey(id))) as Record<string, unknown> | null;
    return row ? row.value : null;
  };

  clear = async (): Promise<void> => {
    this.assertOpen();
    await withLock(this.prefix, () =>
      this.transaction([...STORES], "readwrite", (tx) => {
        const range = rangeForPrefix(this.prefix);
        for (const store of STORES) tx.objectStore(store).delete(range);
      }),
    );
  };

  /** Only explicitly installed packages may retain prepared textual bodies.
   * This also removes read caches written by earlier client versions. */
  discardPreparedReads = async (): Promise<void> => {
    this.assertOpen();
    await withLock(this.prefix,()=>this.transaction(['records'],'readwrite',tx=>{
      for(const task of ['bundle_get','source_get','source_locate','content_get','choice_sequence'])tx.objectStore('records').delete(rangeForPrefix(this.recordKey(`read:${task}:`)));
    }));
  };

  /** Permission changes remove prepared content without touching notes, form
   * drafts, attempts or pending operations. */
  evictPackage = async (projectId:string,personal:boolean): Promise<void> => {
    this.assertOpen();const scope:Scope=personal?'personal':'common';
    await withLock(this.prefix,()=>this.transaction(['records','packages','heads'],'readwrite',tx=>{
      tx.objectStore('packages').delete(this.packageKey(scope,projectId));tx.objectStore('heads').delete(this.headKey(scope,projectId));
      for(const task of ['bundle_get','source_get','source_locate','content_get','choice_sequence'])tx.objectStore('records').delete(rangeForPrefix(this.recordKey(`read:${task}:`)));
    }));
  };

  close = (): void => {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  };
}

export async function openOffline(accountId: string, profileId: string): Promise<OfflineStore> {
  if (!isNonEmptyString(accountId)) fail("INVALID_ACCOUNT", "accountId is required");
  if (!isNonEmptyString(profileId)) fail("INVALID_PROFILE", "profileId is required");
  const db = await openDb();
  return new OfflineStoreImpl(db, accountId, profileId);
}

export async function clearAccount(accountId: string): Promise<void> {
  if (!isNonEmptyString(accountId)) fail("INVALID_ACCOUNT", "accountId is required");
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([...STORES], "readwrite");
      const range = rangeForPrefix(accountPrefix(accountId));
      for (const store of STORES) tx.objectStore(store).delete(range);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new AppError("TX_ABORTED", "transaction aborted", 500));
      tx.onerror = () => reject(tx.error ?? new AppError("TX_FAILED", "transaction failed", 500));
    });
  } finally {
    db.close();
  }
}
