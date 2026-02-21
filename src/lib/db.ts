import fs from 'node:fs'
import path from 'node:path'
import { Database } from 'bun:sqlite'

let db: Database | null = null

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
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE TRIGGER IF NOT EXISTS streams_updated_at
    AFTER UPDATE ON streams
    BEGIN
      UPDATE streams SET updated_at = datetime('now') WHERE id = NEW.id;
    END;
  `)
  try {
    db.exec('ALTER TABLE streams ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0')
  } catch { /* column already exists — safe to ignore */ }
  return db
}

export type Stream = {
  id: string
  name: string
  photo_url?: string | null
  is_favorite: number   // 0 | 1
  created_at: string
  updated_at: string
}

export function getAllStreams(): Stream[] {
  return ensureDb().prepare(
    'SELECT id,name,photo_url,is_favorite,created_at,updated_at FROM streams ORDER BY created_at DESC'
  ).all() as Stream[]
}

export function getStream(id: string): Stream | undefined {
  return ensureDb().prepare(
    'SELECT id,name,photo_url,is_favorite,created_at,updated_at FROM streams WHERE id = ?'
  ).get(id) as Stream | undefined
}

export function toggleFavorite(id: string): Stream | null {
  const current = getStream(id)
  if (!current) return null
  const next = current.is_favorite ? 0 : 1
  ensureDb().prepare('UPDATE streams SET is_favorite = ? WHERE id = ?').run(next, id)
  return getStream(id)!
}

export function createStream(input: { id: string; name: string; photo_url?: string | null }): Stream {
  const { id, name, photo_url = null } = input
  const database = ensureDb()
  database.prepare('INSERT INTO streams (id,name,photo_url) VALUES (?,?,?)').run(id, name, photo_url)
  return getStream(id)!
}

export function updateStream(id: string, updates: { name?: string; photo_url?: string | null }): Stream | null {
  const current = getStream(id)
  if (!current) return null
  const name = updates.name ?? current.name
  const photo_url = updates.photo_url ?? current.photo_url ?? null
  ensureDb().prepare('UPDATE streams SET name = ?, photo_url = ? WHERE id = ?').run(name, photo_url, id)
  return getStream(id)!
}

export function deleteStream(id: string): void {
  ensureDb().prepare('DELETE FROM streams WHERE id = ?').run(id)
}
