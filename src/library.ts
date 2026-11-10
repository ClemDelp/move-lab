/**
 * Bibliothèque locale : les vidéos importées sont gardées dans IndexedDB
 * (le stockage du navigateur fait pour les gros fichiers ; localStorage est
 * limité à ~5 Mo). Le travail (étapes, boucle…) reste dans localStorage.
 */

export interface LibEntry {
  key: string
  /** nom du fichier d'origine */
  name: string
  /** nom choisi par l'utilisateur */
  title: string
  type: string
  size: number
  blob: Blob
  thumb: string | null
  added: number
  updated: number
}

const DB_NAME = 'movelab'
const STORE = 'clips'
let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  dbPromise.catch(() => (dbPromise = null))
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        tx.oncomplete = () => resolve(req.result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

export async function listClips(): Promise<LibEntry[]> {
  const all = await run('readonly', (s) => s.getAll() as IDBRequest<LibEntry[]>)
  return all.sort((a, b) => b.updated - a.updated)
}

export function getClip(key: string): Promise<LibEntry | undefined> {
  return run('readonly', (s) => s.get(key) as IDBRequest<LibEntry | undefined>)
}

/** Ajoute la vidéo, ou met à jour sa date si elle y est déjà. */
export async function saveClip(file: File, key: string): Promise<void> {
  const prev = await getClip(key)
  const now = Date.now()
  const entry: LibEntry = prev
    ? { ...prev, updated: now }
    : {
        key,
        name: file.name,
        title: file.name.replace(/\.[^.]+$/, ''),
        type: file.type,
        size: file.size,
        blob: file,
        thumb: null,
        added: now,
        updated: now,
      }
  await run('readwrite', (s) => s.put(entry))
  // demande au navigateur de ne pas effacer ces données quand il manque de place
  navigator.storage?.persist?.().catch(() => {})
}

export async function updateClip(key: string, patch: Partial<Pick<LibEntry, 'title' | 'thumb'>>) {
  const prev = await getClip(key)
  if (prev) await run('readwrite', (s) => s.put({ ...prev, ...patch }))
}

export async function deleteClip(key: string) {
  await run('readwrite', (s) => s.delete(key))
  try {
    localStorage.removeItem('movelab:' + key)
  } catch {
    /* rien */
  }
}
