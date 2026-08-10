/**
 * Multi-tabela TUSS (migration 0037, ampliada pela 0194):
 *   - searchTussCatalog filtra por tuss_table quando passado
 *   - resultado devolve manufacturer e tussTable para cada row
 *   - a busca textual encontra em manufacturer além de code/description
 *   - a Tabela 18 (diárias e taxas) entra como quarta tabela
 *   - a busca ignora acento (índice trigram sobre a expressão sem acento)
 *   - o route handler encaminha o param ?table=
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTussCode } from '@/tests/helpers/seed-factories'
import { searchTussCatalog } from '@/lib/core/catalog/list-tuss'

describe('TUSS multi-tabela (22, 19, 20, 18)', () => {
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
    await seedTussCode('60000015', {
      tussTable: '18',
      description: 'DIÁRIA COMPACTA DE APARTAMENTO COM ALOJAMENTO CONJUNTO',
    })
  })

  it('sem filtro de tabela retorna códigos das quatro', async () => {
    const sb = serviceClient()
    const results = await searchTussCatalog(sb, { limit: 200 })
    const tables = new Set(results.map((r) => r.tussTable))
    expect(tables).toEqual(new Set(['22', '19', '20', '18']))
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

  it('filtra por table=18 e devolve label Diárias e taxas', async () => {
    const sb = serviceClient()
    const results = await searchTussCatalog(sb, { table: '18', limit: 50 })
    const diaria = results.find((r) => r.code === '60000015')
    expect(diaria?.manufacturer).toBeNull()
    expect(diaria?.tussTableLabel).toBe('Diárias e taxas')
  })

  it('busca textual encontra em manufacturer (abbott → tabela 19)', async () => {
    const sb = serviceClient()
    const results = await searchTussCatalog(sb, { query: 'abbott', table: '19', limit: 20 })
    expect(results.some((r) => r.code === '70965676')).toBe(true)
  })

  it('busca pelo código encontra o item', async () => {
    const sb = serviceClient()
    const results = await searchTussCatalog(sb, { query: '10101012', limit: 20 })
    expect(results.some((r) => r.code === '10101012')).toBe(true)
  })

  // O índice trigram da 0194 é sobre a expressão sem acento: quem digita
  // "consultorio" no teclado sem acentuação tem que achar "consultório".
  it('busca ignora acento nos dois sentidos', async () => {
    const sb = serviceClient()
    const semAcento = await searchTussCatalog(sb, { query: 'consultorio', limit: 20 })
    expect(semAcento.some((r) => r.code === '10101012')).toBe(true)
    const comAcento = await searchTussCatalog(sb, { query: 'consultório', limit: 20 })
    expect(comAcento.some((r) => r.code === '10101012')).toBe(true)
  })

  it('não devolve código aposentado', async () => {
    const sb = serviceClient()
    await seedTussCode('30310170', {
      tussTable: '22',
      description: 'Procedimento aposentado de teste',
      retired: true,
    })
    const results = await searchTussCatalog(sb, { query: '30310170', limit: 20 })
    expect(results.some((r) => r.code === '30310170')).toBe(false)
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
