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
process.env.DB_PATH = dbFile

const {
  getAllStreams,
  getStream,
  countStreams,
  createStream,
  updateStream,
  deleteStream,
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
