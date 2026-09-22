/**
 * Firestore sync overlay.
 *
 * Keeps localStorage as the source-of-truth but mirrors writes to Firestore
 * and listens to remote changes in real time.  When Firebase is unavailable
 * the app degrades gracefully — all operations continue using localStorage
 * only.
 *
 * Tables mirrored: users, rooms, room_members, tasks, task_deps,
 * messages, notifications.
 */

import {
  User, Room, RoomMember, Task, TaskDep, Message, Notification,
  now,
} from './database'

import { waitForFirebase, getFirestore, hasFirebaseConfig } from './firebase'

// ─── Helpers ────────────────────────────────────────────────────────────────

const NS = 'ontrack_'

function lsGet<T>(table: string): T[] {
  try {
    const raw = localStorage.getItem(NS + table)
    return raw ? (JSON.parse(raw) as T[]) : []
  } catch {
    return []
  }
}

function lsSet<T>(table: string, rows: T[]): void {
  localStorage.setItem(NS + table, JSON.stringify(rows))
}

function lsMerge<T extends { id: string }>(table: string, rows: T[]): void {
  const existing = new Map(lsGet<T>(table).map((r) => [r.id, r]))
  for (const row of rows) {
    if (row.id) {
      const existingRow = existing.get(row.id)
      if (existingRow) {
        const merged = { ...existingRow, ...row }
        // Preserve positions if Firestore data has zeroes but local has real values
        if (table === 'tasks') {
          const er = existingRow as any
          const rr = row as any
          if (rr.x === 0 && er.x > 0) (merged as any).x = er.x
          if (rr.y === 0 && er.y > 0) (merged as any).y = er.y
        }
        existing.set(row.id, merged)
      } else {
        existing.set(row.id, row)
      }
    }
  }
  lsSet(table, Array.from(existing.values()))
}

/**
 * Derive a Firestore document ID for a row.
 * - Most tables use row.id directly.
 * - room_members uses a composite key `${roomId}:${userId}`
 *   because RoomMember has no single `id` field.
 */
function docId(table: string, row: any): string | null {
  if (table === 'room_members') {
    if (row.roomId && row.userId) return `${row.roomId}:${row.userId}`
    return null
  }
  if (table === 'task_deps') {
    if (row.taskId && row.dependsOnId) return `${row.taskId}:${row.dependsOnId}`
    return null
  }
  return row.id ?? null
}

/** Convert a Firestore doc snapshot (which has `id` + `data()`) into a row. */
function snapToRow(doc: any): any {
  return { id: doc.id, ...doc.data() }
}

/**
 * Get the localStorage key for a Firestore collection.
 * room_members collection ↔ 'members' localStorage key
 */
function lsKeyForCollection(colName: string): string {
  if (colName === 'room_members') return 'members'
  return colName
}

// ─── Firestore collection helpers ──────────────────────────────────────────

function col(db: any, name: string): any {
  return db.collection(name)
}

async function colSet(db: any, name: string, rows: any[]): Promise<void> {
  const batch = db.batch()
  for (const row of rows) {
    const id = docId(name, row)
    if (id) {
      batch.set(col(db, name).doc(id), row, { merge: true })
    }
  }
  await batch.commit()
}

async function colClearAndWrite(
  db: any,
  name: string,
  rows: any[],
): Promise<void> {
  const snap = await col(db, name).get()
  const batch = db.batch()
  snap.forEach((doc: any) => {
    batch.delete(doc.ref)
  })
  for (const row of rows) {
    const id = docId(name, row)
    if (id) {
      batch.set(col(db, name).doc(id), row, { merge: true })
    }
  }
  await batch.commit()
}

// ─── Public API ─────────────────────────────────────────────────────────────

export type SyncStatus = 'unavailable' | 'connecting' | 'ready' | 'error'

interface SyncEvents extends Event {
  detail: { key: string; value: string }
}

declare global {
  interface WindowEventMap {
    'ontrack:sync': SyncEvents
  }
}

/** Dispatch a synthetic event so the UI layer can re-read localStorage. */
function notifyChange(key: string, value: string): void {
  window.dispatchEvent(
    new CustomEvent('ontrack:sync', { detail: { key, value } }),
  )
}

/**
 * Called once during app startup.  If Firebase is available this function:
 *  1. waits for Firestore to be ready (≤ 5 s)
 *  2. uploads any localStorage rows that Firestore doesn't know about yet
 *  3. attaches real-time listeners that merge remote changes back into
 *     localStorage and dispatch `ontrack:sync` events.
 */
let listeners: Array<() => void> = []

export async function initFirebaseSync(): Promise<SyncStatus> {
  if (!hasFirebaseConfig) {
    console.info('[firebase-sync] No Firebase config — running localStorage only')
    return 'unavailable'
  }

  const ok = await waitForFirebase(5_000)
  if (!ok) {
    console.warn('[firebase-sync] Firebase SDK not ready — sync disabled')
    return 'error'
  }

  const db = getFirestore()
  if (!db) return 'error'

  console.info('[firebase-sync] Initializing sync with Firestore')

  // Tables to sync (Firestore collection name)
  const collections: string[] = [
    'users',
    'rooms',
    'room_members',
    'tasks',
    'task_deps',
    'messages',
    'notifications',
  ]

  // 1. Push any existing localStorage rows to Firestore
  for (const colName of collections) {
    const lsKey = lsKeyForCollection(colName)
    const rows = lsGet(lsKey)
    if (rows.length) {
      try {
        await colSet(db, colName, rows)
        console.debug('[firebase-sync] Uploaded', rows.length, 'rows to', colName)
      } catch (e) {
        console.warn('[firebase-sync] Bulk write failed:', colName, e)
      }
    }
  }

  // 2. Attach real-time listeners
  for (const colName of collections) {
    const lsKey = lsKeyForCollection(colName)
    const handler = col(db, colName).onSnapshot(
      (snap: any) => {
        const rows: any[] = []
        snap.forEach((doc: any) => {
          rows.push({ id: doc.id, ...doc.data() })
        })

        // room_members and task_deps need special merge logic (composite keys)
        if (colName === 'room_members') {
          const local = lsGet<any>('members')
          const byId = new Map(local.map((m) => [`${m.roomId}:${m.userId}`, m]))
          for (const row of rows) {
            const key = `${row.roomId}:${row.userId}`
            byId.set(key, row)
          }
          lsSet('members', Array.from(byId.values()))
        } else if (colName === 'task_deps') {
          const local = lsGet<any>('task_deps')
          const byId = new Map(local.map((d) => [`${d.taskId}:${d.dependsOnId}`, d]))
          for (const row of rows) {
            const key = `${row.taskId}:${row.dependsOnId}`
            byId.set(key, row)
          }
          lsSet('task_deps', Array.from(byId.values()))
        } else {
          // For regular tables, Firestore doc.id matches row.id
          lsMerge(lsKey, rows)
        }

        notifyChange(NS + lsKey, JSON.stringify(lsGet(lsKey)))
      },
      (err: Error) => {
        console.error('[firebase-sync] Listener error:', colName, err)
      },
    )
    listeners.push(handler)
  }

  // 3. Listen for session changes (cross-device login/logout)
  try {
    const sessionHandler = col(db, 'sessions').onSnapshot(
      (snap: any) => {
        snap.forEach((doc: any) => {
          const { userId } = doc.data() as { userId?: string }
          if (userId) {
            localStorage.setItem(NS + 'session', userId)
            notifyChange(NS + 'session', userId)
          }
        })
      },
    )
    listeners.push(sessionHandler)
  } catch (e) {
    // sessions collection is optional — ignore errors
  }

  console.info('[firebase-sync] Real-time listeners attached for', collections.length, 'collections')
  return 'ready'
}

/**
 * Sync a single table from localStorage → Firestore.
 * Call this after every write operation.
 */
export async function syncTable(
  table: 'users' | 'rooms' | 'members' | 'tasks' | 'task_deps'
    | 'messages' | 'notifications',
): Promise<void> {
  const db = getFirestore()
  if (!db) return

  const colName = table === 'members' ? 'room_members' : table
  const rows = lsGet(colName === 'room_members' ? 'members' : colName)
  try {
    await colClearAndWrite(db, colName, rows)
  } catch (e) {
    console.warn('[firebase-sync] Write failed:', colName, e)
  }
}

/**
 * Write a single row to Firestore.
 * Use this after inserts/updates instead of syncTable for granular writes.
 *
 * @param table  Firestore collection name (e.g. 'tasks')
 * @param row    The row object (must have an `id` field, or for room_members
 *               must have `roomId` and `userId`)
 */
export async function writeRow(
  table: string,
  row: any,
): Promise<void> {
  const db = getFirestore()
  if (!db) return
  const id = docId(table, row)
  if (!id) {
    console.warn('[firebase-sync] No document ID for:', table, row)
    return
  }
  try {
    await col(db, table).doc(id).set(row, { merge: true })
  } catch (e) {
    console.warn('[firebase-sync] Row write failed:', table, id, e)
  }
}

/**
 * Delete a row from Firestore.
 *
 * @param table  Firestore collection name
 * @param id     Document ID — for room_members use `${roomId}:${userId}`
 */
export async function deleteRow(table: string, id: string): Promise<void> {
  const db = getFirestore()
  if (!db) return
  try {
    await col(db, table).doc(id).delete()
  } catch (e) {
    console.warn('[firebase-sync] Row delete failed:', table, id, e)
  }
}

/** Tear down all Firestore real-time listeners (useful for testing). */
export function detachListeners(): void {
  for (const unsub of listeners) {
    unsub()
  }
  listeners = []
}
