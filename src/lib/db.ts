import fs from 'node:fs'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { createDeviceId, isChannelNumber, isValidDeviceId } from './hdhr'

let db: Database | null = null

const COLUMNS =
  'id,name,photo_url,is_favorite,tvg_id,tvg_name,group_title,number,enabled,created_at,updated_at'
const ORDER_BY = 'ORDER BY (number IS NULL), number, name COLLATE NOCASE'

const AUTO_NUMBER_FLOOR = 999
const META_DEVICE_ID = 'hdhr_device_id'
const META_NUMBER_HIGHWATER = 'channel_number_highwater'

function ensureMetaTable(database: Database): void {
  database.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
}

export function getSetting(database: Database, key: string): string | null {
  ensureMetaTable(database)
  const row = database.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSetting(database: Database, key: string, value: string): void {
  ensureMetaTable(database)
  database
    .prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value)
}

function withImmediateTransaction<T>(database: Database, fn: () => T): T {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    database.exec('COMMIT')
    return result
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // ignore rollback failures
    }
    throw error
  }
}

function readHighWater(database: Database): number {
  const stored = Number.parseInt(getSetting(database, META_NUMBER_HIGHWATER) ?? '', 10)
  const row = database.prepare('SELECT MAX(number) AS max FROM streams').get() as {
    max: number | null
  }
  const highestInUse = isChannelNumber(row.max) ? row.max : AUTO_NUMBER_FLOOR
  return Math.max(Number.isFinite(stored) ? stored : AUTO_NUMBER_FLOOR, highestInUse)
}

/**
 * Reserve the next free channel number. Numbers are never reused: the
 * high-water mark is persisted so deleting the highest channel does not free
 * its number for a future stream (Plex keeps a snapshot of the lineup).
 */
export function allocateChannelNumber(database: Database, excludeId?: string): number {
  return withImmediateTransaction(database, () => {
    let next = readHighWater(database) + 1
    while (next <= 99999) {
      const taken = excludeId
        ? database.prepare('SELECT id FROM streams WHERE number = ? AND id <> ? LIMIT 1').get(next, excludeId)
        : database.prepare('SELECT id FROM streams WHERE number = ? LIMIT 1').get(next)
      if (!taken) break
      next++
    }
    if (next > 99999) throw new Error('no free channel numbers available')
    setSetting(database, META_NUMBER_HIGHWATER, String(next))
    return next
  })
}

/**
 * Idempotent backfill: drop invalid/duplicate numbers and assign fresh ones to
 * the affected rows, raising the high-water mark to the highest valid number.
 */
export function backfillChannelNumbers(database: Database): void {
  ensureMetaTable(database)
  withImmediateTransaction(database, () => {
    const rows = database
      .prepare('SELECT id, number FROM streams ORDER BY created_at ASC, id ASC')
      .all() as Array<{ id: string; number: number | null }>

    const seen = new Set<number>()
    const toAssign: string[] = []
    let highWater = AUTO_NUMBER_FLOOR

    for (const row of rows) {
      if (!isChannelNumber(row.number) || seen.has(row.number)) {
        toAssign.push(row.id)
        continue
      }
      seen.add(row.number)
      if (row.number > highWater) highWater = row.number
    }

    const stored = Number.parseInt(getSetting(database, META_NUMBER_HIGHWATER) ?? '', 10)
    if (Number.isFinite(stored) && stored > highWater) highWater = stored

    const assign = database.prepare('UPDATE streams SET number = ? WHERE id = ?')
    for (const id of toAssign) {
      highWater += 1
      assign.run(highWater, id)
    }

    setSetting(database, META_NUMBER_HIGHWATER, String(highWater))
  })
}

/** Stable per-installation HDHomeRun device id (env override wins). */
export function getOrCreateDeviceId(database: Database = ensureDb()): string {
  const fromEnv = (process.env.HDHR_DEVICE_ID ?? '').trim().toUpperCase()
  if (isValidDeviceId(fromEnv)) return fromEnv

  const existing = getSetting(database, META_DEVICE_ID)
  if (isValidDeviceId(existing)) return existing

  const created = createDeviceId()
  setSetting(database, META_DEVICE_ID, created)
  return created
}

function ensureDb(): Database {
  if (db) return db
  const dbPath = process.env.DATABASE_PATH || './data/db.sqlite'
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  db = new Database(dbPath, { create: true })
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS streams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      photo_url TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      tvg_id TEXT,
      tvg_name TEXT,
      group_title TEXT,
      number INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS streams_updated_at
    AFTER UPDATE ON streams
    BEGIN
      UPDATE streams SET updated_at = datetime('now') WHERE id = NEW.id;
    END;
  `)
  migrate(db)
  backfillChannelNumbers(db)
  return db
}

/**
 * Idempotent migration for databases created before the TV metadata columns.
 */
function migrate(database: Database): void {
  const columns = database.prepare('PRAGMA table_info(streams)').all() as { name: string }[]
  const existing = new Set(columns.map((column) => column.name))
  const additions: Array<[string, string]> = [
    ['is_favorite', 'INTEGER NOT NULL DEFAULT 0'],
    ['tvg_id', 'TEXT'],
    ['tvg_name', 'TEXT'],
    ['group_title', 'TEXT'],
    ['number', 'INTEGER'],
    ['enabled', 'INTEGER NOT NULL DEFAULT 1'],
  ]

  for (const [name, type] of additions) {
    if (!existing.has(name)) {
      database.exec(`ALTER TABLE streams ADD COLUMN ${name} ${type}`)
    }
  }
}

export type Stream = {
  id: string
  name: string
  photo_url?: string | null
  is_favorite: number
  tvg_id?: string | null
  tvg_name?: string | null
  group_title?: string | null
  number?: number | null
  enabled: number
  created_at: string
  updated_at: string
}

export type StreamInput = {
  id: string
  name: string
  photo_url?: string | null
  tvg_id?: string | null
  tvg_name?: string | null
  group_title?: string | null
  number?: number | null
  enabled?: boolean
}

export type StreamUpdate = {
  name: string
  photo_url?: string | null
  tvg_id?: string | null
  tvg_name?: string | null
  group_title?: string | null
  number?: number | null
  enabled?: boolean
}

export function getAllStreams(onlyEnabled = false): Stream[] {
  const where = onlyEnabled ? 'WHERE enabled = 1' : ''
  return ensureDb().prepare(
    `SELECT ${COLUMNS} FROM streams ${where} ${ORDER_BY}`
  ).all() as Stream[]
}

export function getStream(id: string): Stream | undefined {
  return ensureDb().prepare(
    `SELECT ${COLUMNS} FROM streams WHERE id = ?`
  ).get(id) as Stream | undefined
}

export function toggleFavorite(id: string): Stream | null {
  const current = getStream(id)
  if (!current) return null
  const next = current.is_favorite ? 0 : 1
  ensureDb().prepare('UPDATE streams SET is_favorite = ? WHERE id = ?').run(next, id)
  return getStream(id)!
}

export function countStreams(): number {
  const row = ensureDb().prepare('SELECT COUNT(*) AS total FROM streams').get() as { total: number }
  return row.total
}

function resolveNewNumber(database: Database, requested: number | null | undefined): number {
  if (isChannelNumber(requested)) {
    const taken = database.prepare('SELECT id FROM streams WHERE number = ? LIMIT 1').get(requested)
    if (!taken) return requested
  }
  return allocateChannelNumber(database)
}

export function createStream(input: StreamInput): Stream {
  const database = ensureDb()
  const number = resolveNewNumber(database, input.number)
  database.prepare(
    `INSERT INTO streams (id,name,photo_url,tvg_id,tvg_name,group_title,number,enabled)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    input.id,
    input.name,
    input.photo_url ?? null,
    input.tvg_id ?? null,
    input.tvg_name ?? null,
    input.group_title ?? null,
    number,
    input.enabled === false ? 0 : 1
  )
  return getStream(input.id)!
}

export function updateStream(id: string, updates: StreamUpdate): Stream | null {
  const database = ensureDb()
  const current = getStream(id)
  if (!current) return null

  let number: number
  if (updates.number === undefined) {
    number = isChannelNumber(current.number) ? current.number : allocateChannelNumber(database, id)
  } else if (isChannelNumber(updates.number)) {
    const taken = database
      .prepare('SELECT id FROM streams WHERE number = ? AND id <> ? LIMIT 1')
      .get(updates.number, id)
    number = taken ? allocateChannelNumber(database, id) : updates.number
  } else {
    number = allocateChannelNumber(database, id)
  }

  const next = {
    name: updates.name ?? current.name,
    photo_url: updates.photo_url === undefined ? (current.photo_url ?? null) : updates.photo_url,
    tvg_id: updates.tvg_id === undefined ? (current.tvg_id ?? null) : updates.tvg_id,
    tvg_name: updates.tvg_name === undefined ? (current.tvg_name ?? null) : updates.tvg_name,
    group_title: updates.group_title === undefined ? (current.group_title ?? null) : updates.group_title,
    number,
    enabled: updates.enabled === undefined ? current.enabled : (updates.enabled ? 1 : 0),
  }
  database.prepare(
    `UPDATE streams
     SET name = ?, photo_url = ?, tvg_id = ?, tvg_name = ?, group_title = ?, number = ?, enabled = ?
     WHERE id = ?`
  ).run(
    next.name,
    next.photo_url,
    next.tvg_id,
    next.tvg_name,
    next.group_title,
    next.number,
    next.enabled,
    id
  )
  return getStream(id)!
}

export function deleteStream(id: string): void {
  ensureDb().prepare('DELETE FROM streams WHERE id = ?').run(id)
}

/**
 * Replaces a stream's AceStream id in place: every other field is preserved
 * (including channel number, favorite flag and creation date), so TV clients
 * keep their mapping when a source dies and a new infohash takes over.
 */
export function replaceStreamId(oldId: string, newId: string): Stream | null {
  const database = ensureDb()
  if (!getStream(oldId)) return null
  if (getStream(newId)) return null

  withImmediateTransaction(database, () => {
    database.prepare(
      `INSERT INTO streams (id,name,photo_url,is_favorite,tvg_id,tvg_name,group_title,number,enabled,created_at,updated_at)
       SELECT ?,name,photo_url,is_favorite,tvg_id,tvg_name,group_title,number,enabled,created_at,updated_at
       FROM streams WHERE id = ?`
    ).run(newId, oldId)
    database.prepare('DELETE FROM streams WHERE id = ?').run(oldId)
  })

  return getStream(newId) ?? null
}
