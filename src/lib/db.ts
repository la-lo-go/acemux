import fs from 'node:fs'
import path from 'node:path'
import { Database } from 'bun:sqlite'

let db: Database | null = null

const COLUMNS =
  'id,name,photo_url,is_favorite,tvg_id,tvg_name,group_title,number,enabled,created_at,updated_at'
const ORDER_BY = 'ORDER BY (number IS NULL), number, name COLLATE NOCASE'

function ensureDb(): Database {
  if (db) return db
  const dbPath = process.env.DB_PATH || './data/db.sqlite'
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  db = new Database(dbPath, { create: true })
  db.exec(`
    PRAGMA journal_mode = WAL;
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
    CREATE TRIGGER IF NOT EXISTS streams_updated_at
    AFTER UPDATE ON streams
    BEGIN
      UPDATE streams SET updated_at = datetime('now') WHERE id = NEW.id;
    END;
  `)
  migrate(db)
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

export function createStream(input: StreamInput): Stream {
  ensureDb().prepare(
    `INSERT INTO streams (id,name,photo_url,tvg_id,tvg_name,group_title,number,enabled)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    input.id,
    input.name,
    input.photo_url ?? null,
    input.tvg_id ?? null,
    input.tvg_name ?? null,
    input.group_title ?? null,
    input.number ?? null,
    input.enabled === false ? 0 : 1
  )
  return getStream(input.id)!
}

export function updateStream(id: string, updates: StreamUpdate): Stream | null {
  const current = getStream(id)
  if (!current) return null
  const next = {
    name: updates.name ?? current.name,
    photo_url: updates.photo_url === undefined ? (current.photo_url ?? null) : updates.photo_url,
    tvg_id: updates.tvg_id === undefined ? (current.tvg_id ?? null) : updates.tvg_id,
    tvg_name: updates.tvg_name === undefined ? (current.tvg_name ?? null) : updates.tvg_name,
    group_title: updates.group_title === undefined ? (current.group_title ?? null) : updates.group_title,
    number: updates.number === undefined ? (current.number ?? null) : updates.number,
    enabled: updates.enabled === undefined ? current.enabled : (updates.enabled ? 1 : 0),
  }
  ensureDb().prepare(
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
