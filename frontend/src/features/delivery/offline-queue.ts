/**
 * DEL-020/021: the courier's write-ahead queue.
 *
 * A courier loses signal in stairwells and basements, so every action is written to IndexedDB before
 * it is attempted and only removed once the server has accounted for it. Three rules follow:
 *
 * - the `operation_id` is minted here, on the device, so a retry is the same operation and the server
 *   can answer `DUPLICATE` instead of acting twice (DEL-023);
 * - a handover code never rests in the clear. A tab-session WebCrypto key encrypts it;
 *   IndexedDB contains the ciphertext but never the key (DEL-021);
 * - `CONFLICT` and `REJECTED` leave the queue and go to the issues screen. The device does not retry
 *   them and does not argue with the server's state (DEL-024/026).
 */

const DB_NAME = 'tezfarmo-courier';
const STORE = 'operations';
const DB_VERSION = 1;

export type OperationType = 'DELIVERY_ARRIVE' | 'DELIVERY_CONFIRM' | 'DELIVERY_FAIL';
export type QueueState = 'PENDING' | 'CONFLICT' | 'REJECTED';

export type QueuedOperation = {
  scope: string;
  operation_id: string;
  operation_type: OperationType;
  entity_id: string;
  /** What the server may keep. The code is never in here. */
  payload: Record<string, unknown>;
  /** AES-GCM over the code, unwrappable only while this session's key lives. */
  sealed_code?: { iv: number[]; data: number[] };
  expected_status: string | null;
  client_created_at: string;
  retry_count: number;
  next_retry_at?: number;
  status: QueueState;
  error?: string;
  server_status?: string;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'operation_id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

/*
 * sessionStorage keeps the key across reloads in this tab, independently of IndexedDB.
 * A later tab cannot decrypt abandoned confirmations; they become visible issues.
 */
let sessionKey: Promise<CryptoKey> | null = null;

function key(): Promise<CryptoKey> {
  sessionKey ??= (async () => {
    let raw = sessionStorage.getItem('courier-session-key');
    if (!raw) {
      raw = JSON.stringify([...crypto.getRandomValues(new Uint8Array(32))]);
      sessionStorage.setItem('courier-session-key', raw);
    }
    return crypto.subtle.importKey('raw', new Uint8Array(JSON.parse(raw) as number[]), 'AES-GCM', false, ['encrypt', 'decrypt']);
  })();
  return sessionKey;
}

export function resetSessionKey(): void {
  sessionKey = null;
  sessionStorage.removeItem('courier-session-key');
}

/** UUIDv7, with its 48-bit millisecond timestamp and cryptographic random tail. */
export function operationId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let stamp = BigInt(Date.now());
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(stamp & 255n);
    stamp >>= 8n;
  }
  bytes[6] = 0x70 | (bytes[6]! & 15);
  bytes[8] = 0x80 | (bytes[8]! & 63);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function operations(scope?: string): Promise<QueuedOperation[]> {
  if (typeof indexedDB === 'undefined') return [];
  const rows = await run<QueuedOperation[]>('readonly', (store) => store.getAll());
  return rows.filter((row) => !scope || row.scope === scope).sort((a, b) => a.client_created_at.localeCompare(b.client_created_at));
}

export async function enqueue(
  scope: string,
  type: OperationType,
  entity: string,
  expected: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { code, ...safe } = payload;
  const row: QueuedOperation = {
    scope,
    operation_id: operationId(),
    operation_type: type,
    entity_id: entity,
    payload: safe,
    expected_status: expected,
    client_created_at: new Date().toISOString(),
    retry_count: 0,
    status: 'PENDING',
    ...(typeof code === 'string' ? { sealed_code: await seal(code) } : {}),
  };
  await save(row);
}

export async function save(row: QueuedOperation): Promise<void> {
  await run('readwrite', (store) => store.put(row));
}

export async function remove(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(id));
}

export async function wire(row: QueuedOperation) {
  const code = row.sealed_code ? await unseal(row.sealed_code) : undefined;
  if (code === null) return null;
  return {
    operation_id: row.operation_id,
    operation_type: row.operation_type,
    entity_id: row.entity_id,
    payload: { ...row.payload, ...(code ? { code } : {}) },
    expected_status: row.expected_status,
    client_created_at: row.client_created_at,
  };
}

async function seal(code: string): Promise<{ iv: number[]; data: number[] }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(code));
  return { iv: [...iv], data: [...new Uint8Array(data)] };
}

async function unseal(sealed: { iv: number[]; data: number[] }): Promise<string | null> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(sealed.iv) }, await key(), new Uint8Array(sealed.data));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
