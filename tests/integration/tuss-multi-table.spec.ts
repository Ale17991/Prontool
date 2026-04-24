/**
 * Multi-tabela TUSS (migration 0037):
 *   - searchTussCatalog filtra por tuss_table quando passado
 *   - resultado devolve manufacturer e tussTable para cada row
 *   - a busca textual encontra em manufacturer além de code/description
 *   - o route handler encaminha o param ?table=
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTussCode } from '@/tests/helpers/seed-factories'
import { searchTussCatalog } from '@/lib/core/catalog/list-tuss'

describe('TUSS multi-tabela (22, 19, 20)', () => {
  beforeAll(async () => {
    await resetDatabase({ wipeCatalog: true })
    await seedTussCode('10101012', {
      tussTable: '22',
      description: 'Consulta em consultório',
    })
    await seedTussCode('70965676', {
      tussTable: '19',
      description: 'GRAFTMASTER RX CORONARY STENT',
      manufacturer: 'ABBOTT LABORATÓRIOS DO BRASIL LTDA',
    })
    await seedTussCode('90051505', {
      tussTable: '20',
      description: 'REOPRO 2 MG/ML SOL INJ',
      manufacturer: 'ELI LILLY DO BRASIL LTDA',
    })
  })

  it('sem filtro de tabela retorna códigos das três', async () => {
    const sb = serviceClient()
    const results = await searchTussCatalog(sb, { limit: 200 })
    const tables = new Set(results.map((r) => r.tussTable))
    expect(tables).toEqual(new Set(['22', '19', '20']))
  })

  it('filtra por table=22 e devolve só procedimentos', async () => {
    const sb = serviceClient()
    const results = await searchTussCatalog(sb, { table: '22', limit: 50 })
    expect(results.length).toBeGreaterThanOrEqual(1)
    for (const r of results) expect(r.tussTable).toBe('22')
    const consulta = results.find((r) => r.code === '10101012')
    expect(consulta?.manufacturer).toBeNull()
    expect(consulta?.tussTableLabel).toBe('Procedimentos')
  })

  it('filtra por table=19 e devolve manufacturer populado', async () => {
    const sb = serviceClient()
    const results = await searchTussCatalog(sb, { table: '19', limit: 50 })
    const mat = results.find((r) => r.code === '70965676')
    expect(mat?.manufacturer).toBe('ABBOTT LABORATÓRIOS DO BRASIL LTDA')
    expect(mat?.tussTableLabel).toBe('Materiais')
  })

  it('filtra por table=20 e devolve label Medicamentos', async () => {
    const sb = serviceClient()
    const results = await searchTussCatalog(sb, { table: '20', limit: 50 })
    const med = results.find((r) => r.code === '90051505')
    expect(med?.manufacturer).toBe('ELI LILLY DO BRASIL LTDA')
    expect(med?.tussTableLabel).toBe('Medicamentos')
  })

  it('busca textual encontra em manufacturer (abbott → tabela 19)', async () => {
    const sb = serviceClient()
    const results = await searchTussCatalog(sb, { query: 'abbott', table: '19', limit: 20 })
    expect(results.some((r) => r.code === '70965676')).toBe(true)
  })
})

describe('GET /api/tuss-codes route handler', () => {
  it('exporta GET function', async () => {
    const mod = await import('@/app/api/tuss-codes/route')
    expect(typeof (mod as { GET?: unknown }).GET).toBe('function')
  })

  it('GET sem auth devolve 401 UNAUTHORIZED', async () => {
    const mod = await import('@/app/api/tuss-codes/route')
    const GET = (mod as { GET: (req: Request) => Promise<Response> }).GET
    const req = new Request('http://local/api/tuss-codes?table=22')
    const res = await GET(req)
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHORIZED')
  })
})
