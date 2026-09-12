import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const opened: Database[] = []

class TrackedDatabase extends Database {
  constructor(filename?: string, options?: any) {
    super(filename, options)
    opened.push(this)
  }
}

mock.module('bun:sqlite', () => ({ Database: TrackedDatabase }))

const dbFile = path.join(
  os.tmpdir(),
  `acemux-db-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`
)
process.env.DATABASE_PATH = dbFile

const {
  getAllStreams,
  getStream,
  countStreams,
  createStream,
  updateStream,
  deleteStream,
  toggleFavorite,
  allocateChannelNumber,
  backfillChannelNumbers,
  replaceStreamId,
} = await import('../src/lib/db')

function clean(): void {
  for (const stream of getAllStreams()) deleteStream(stream.id)
}

beforeEach(() => {
  clean()
})

afterAll(() => {
  for (const database of opened) database.close()
  Bun.gc(true)
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbFile}${suffix}`, { force: true })
  }
})

describe('createStream', () => {
  test('persiste los campos nuevos', () => {
    const created = createStream({
      id: 'id-1',
      name: 'Canal',
      photo_url: 'http://logo.png',
      tvg_id: 'tvg-1',
      tvg_name: 'TVG Uno',
      group_title: 'Deportes',
      number: 5,
      enabled: false,
    })

    expect(created.id).toBe('id-1')
    expect(created.name).toBe('Canal')
    expect(created.photo_url).toBe('http://logo.png')
    expect(created.tvg_id).toBe('tvg-1')
    expect(created.tvg_name).toBe('TVG Uno')
    expect(created.group_title).toBe('Deportes')
    expect(created.number).toBe(5)
    expect(created.enabled).toBe(0)

    const fetched = getStream('id-1')
    expect(fetched).toBeDefined()
    expect(fetched!.tvg_id).toBe('tvg-1')
    expect(fetched!.group_title).toBe('Deportes')
    expect(fetched!.number).toBe(5)
    expect(fetched!.enabled).toBe(0)
  })

  test('enabled por defecto es 1', () => {
    expect(createStream({ id: 'id-2', name: 'Canal' }).enabled).toBe(1)
  })
})

describe('getAllStreams', () => {
  test('getAllStreams(true) solo devuelve los enabled', () => {
    createStream({ id: 'on-1', name: 'Activo', number: 1 })
    createStream({ id: 'off-1', name: 'Inactivo', number: 2, enabled: false })

    expect(getAllStreams()).toHaveLength(2)
    const enabled = getAllStreams(true)
    expect(enabled).toHaveLength(1)
    expect(enabled[0].id).toBe('on-1')
  })
})

describe('countStreams', () => {
  test('cuenta todas las filas', () => {
    expect(countStreams()).toBe(0)
    createStream({ id: 'id-1', name: 'Uno' })
    createStream({ id: 'id-2', name: 'Dos', enabled: false })
    expect(countStreams()).toBe(2)
  })
})

describe('updateStream', () => {
  test('actualiza campo a campo y enabled:false pasa a 0', () => {
    createStream({ id: 'id-1', name: 'Original', tvg_id: 'tvg-1', group_title: 'Grupo' })

    const updated = updateStream('id-1', {
      name: 'Nuevo',
      tvg_id: 'tvg-2',
      group_title: 'Otro',
      number: 7,
      enabled: false,
    })

    expect(updated).not.toBeNull()
    expect(updated!.name).toBe('Nuevo')
    expect(updated!.tvg_id).toBe('tvg-2')
    expect(updated!.group_title).toBe('Otro')
    expect(updated!.number).toBe(7)
    expect(updated!.enabled).toBe(0)
  })

  test('omitir un campo no lo borra', () => {
    createStream({
      id: 'id-1',
      name: 'Original',
      photo_url: 'http://logo.png',
      tvg_id: 'tvg-1',
      group_title: 'Grupo',
      number: 3,
    })

    const updated = updateStream('id-1', { name: 'Renombrado' })

    expect(updated!.name).toBe('Renombrado')
    expect(updated!.photo_url).toBe('http://logo.png')
    expect(updated!.tvg_id).toBe('tvg-1')
    expect(updated!.group_title).toBe('Grupo')
    expect(updated!.number).toBe(3)
  })

  test('devuelve null si el id no existe', () => {
    expect(updateStream('missing', { name: 'X' })).toBeNull()
  })
})

describe('deleteStream', () => {
  test('elimina la fila', () => {
    createStream({ id: 'id-1', name: 'Canal' })
    expect(getStream('id-1')).toBeDefined()

    deleteStream('id-1')

    expect(getStream('id-1')).toBeNull()
    expect(countStreams()).toBe(0)
  })
})

describe('channel numbering', () => {
  test('asigna números automáticos desde 1000 y no reutiliza al borrar', () => {
    const a = createStream({ id: 'num-a', name: 'A' })
    const b = createStream({ id: 'num-b', name: 'B' })

    expect(a.number).toBeGreaterThanOrEqual(1000)
    expect(b.number).toBe((a.number as number) + 1)

    deleteStream('num-b')
    const c = createStream({ id: 'num-c', name: 'C' })
    expect(c.number).toBeGreaterThan(b.number as number)
  })

  test('respeta un número libre y evita duplicados', () => {
    createStream({ id: 'num-a', name: 'A', number: 42 })
    const duplicate = createStream({ id: 'num-b', name: 'B', number: 42 })

    expect(duplicate.number).not.toBe(42)
    expect(duplicate.number).toBeGreaterThanOrEqual(1000)
  })

  test('updateStream conserva el número si no se envía y asigna otro si se limpia', () => {
    createStream({ id: 'num-a', name: 'A', number: 7 })

    const kept = updateStream('num-a', { name: 'A2' })
    expect(kept!.number).toBe(7)

    const cleared = updateStream('num-a', { name: 'A3', number: null })
    expect(cleared!.number).not.toBe(7)
    expect(cleared!.number).toBeGreaterThanOrEqual(1000)
  })

  test('allocateChannelNumber reserva el high-water mark', () => {
    const scratch = new Database(':memory:')
    scratch.exec('CREATE TABLE streams (id TEXT PRIMARY KEY, number INTEGER, created_at DATETIME)')

    expect(allocateChannelNumber(scratch)).toBe(1000)
    expect(allocateChannelNumber(scratch)).toBe(1001)

    scratch.close()
  })

  test('backfillChannelNumbers valida, deduplica y es idempotente', () => {
    const legacyFile = path.join(
      os.tmpdir(),
      `acemux-legacy-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`
    )
    const legacy = new Database(legacyFile, { create: true })
    legacy.exec(`
      CREATE TABLE streams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        photo_url TEXT,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        tvg_id TEXT,
        tvg_name TEXT,
        group_title TEXT,
        number INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME,
        updated_at DATETIME
      )
    `)
    const insert = legacy.prepare('INSERT INTO streams (id,name,number,created_at) VALUES (?,?,?,?)')
    insert.run('a', 'A', null, '2026-01-01 00:00:00')
    insert.run('b', 'B', null, '2026-01-02 00:00:00')
    insert.run('c', 'C', 5, '2026-01-03 00:00:00')
    insert.run('d', 'D', 5, '2026-01-04 00:00:00')
    insert.run('e', 'E', 0, '2026-01-05 00:00:00')
    insert.run('f', 'F', 12000, '2026-01-06 00:00:00')

    const number = (id: string): number =>
      (legacy.prepare('SELECT number FROM streams WHERE id = ?').get(id) as { number: number }).number

    backfillChannelNumbers(legacy)

    expect(number('c')).toBe(5)
    expect(number('f')).toBe(12000)
    const assigned = [number('a'), number('b'), number('d'), number('e')]
    expect(new Set(assigned).size).toBe(4)
    expect(Math.min(...assigned)).toBeGreaterThan(12000)

    const snapshot = ['a', 'b', 'c', 'd', 'e', 'f'].map(number)
    backfillChannelNumbers(legacy)
    expect(['a', 'b', 'c', 'd', 'e', 'f'].map(number)).toEqual(snapshot)

    expect(allocateChannelNumber(legacy)).toBe(Math.max(...snapshot) + 1)

    legacy.close()
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(`${legacyFile}${suffix}`, { force: true })
      } catch {
        // Windows may keep the WAL file locked briefly; the temp file is harmless
      }
    }
  })
})

describe('replaceStreamId', () => {
  test('mueve el stream a un nuevo id conservando todos los campos', () => {
    const created = createStream({
      id: 'old-src',
      name: 'Canal',
      photo_url: 'http://logo.png',
      tvg_id: 'tvg-1',
      tvg_name: 'Nombre TV',
      group_title: 'Deportes',
      number: 42,
      enabled: false,
    })
    toggleFavorite('old-src')

    const replaced = replaceStreamId('old-src', 'new-src')

    expect(replaced).not.toBeNull()
    expect(getStream('old-src')).toBeNull()

    const next = getStream('new-src')!
    expect(next.name).toBe('Canal')
    expect(next.photo_url).toBe('http://logo.png')
    expect(next.tvg_id).toBe('tvg-1')
    expect(next.tvg_name).toBe('Nombre TV')
    expect(next.group_title).toBe('Deportes')
    expect(next.number).toBe(42)
    expect(next.enabled).toBe(0)
    expect(next.is_favorite).toBe(1)
    expect(next.created_at).toBe(created.created_at)
  })

  test('devuelve null si falta el origen o el destino ya existe', () => {
    expect(replaceStreamId('missing', 'new-src')).toBeNull()

    createStream({ id: 'keep-a', name: 'A' })
    createStream({ id: 'keep-b', name: 'B' })

    expect(replaceStreamId('keep-a', 'keep-b')).toBeNull()
    expect(getStream('keep-a')).not.toBeNull()
    expect(getStream('keep-b')).not.toBeNull()
  })
})
