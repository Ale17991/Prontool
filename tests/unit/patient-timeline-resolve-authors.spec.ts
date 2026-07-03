/**
 * Unit tests para src/lib/core/patient-timeline/resolve-authors.ts
 * Cobre: short-circuit por knownDoctors, hit em doctors, hit em
 * user_profile, fallback (user ausente em ambos), formatAuthorDisplay.
 */
import { describe, it, expect, vi } from 'vitest'
import { resolveAuthors, formatAuthorDisplay } from '@/lib/core/patient-timeline/resolve-authors'

interface ChainStep {
  table: string
  filters: Array<{ method: string; args: unknown[] }>
  data: unknown[]
  error: { message: string } | null
}

function fakeSupabase(steps: ChainStep[]): {
  client: {
    from: (table: string) => unknown
  }
  callLog: Array<{ table: string; chain: string[] }>
} {
  const callLog: Array<{ table: string; chain: string[] }> = []

  function makeChain(step: ChainStep): unknown {
    const chain: string[] = []
    const proxy: Record<string, unknown> = {}
    const finish = () => Promise.resolve({ data: step.data, error: step.error })
    const methods = ['select', 'eq', 'in', 'not']
    for (const m of methods) {
      proxy[m] = (..._args: unknown[]) => {
        chain.push(m)
        return proxy
      }
    }
    proxy.then = (resolve: (v: unknown) => unknown) => finish().then(resolve)
    callLog.push({ table: step.table, chain })
    return proxy
  }

  const steps2 = [...steps]
  return {
    client: {
      from: (table: string) => {
        const step = steps2.shift()
        if (!step) {
          return makeChain({ table, filters: [], data: [], error: null })
        }
        return makeChain(step)
      },
    },
    callLog,
  }
}

describe('resolveAuthors', () => {
  it('short-circuit: knownDoctors cobre todos os user_ids → não consulta DB', async () => {
    const { client, callLog } = fakeSupabase([])
    const result = await resolveAuthors(client as never, {
      tenantId: 't1',
      userIds: new Set(['u1', 'u2']),
      knownDoctors: [
        { user_id: 'u1', full_name: 'Dr. Alfa' },
        { user_id: 'u2', full_name: 'Dra. Beta' },
      ],
    })
    expect(result.get('u1')).toBe('Dr. Alfa')
    expect(result.get('u2')).toBe('Dra. Beta')
    expect(callLog.length).toBe(0)
  })

  it('hit em doctors quando não está no knownDoctors', async () => {
    const { client } = fakeSupabase([
      {
        table: 'doctors',
        filters: [],
        data: [{ user_id: 'u3', full_name: 'Dr. Gama' }],
        error: null,
      },
    ])
    const result = await resolveAuthors(client as never, {
      tenantId: 't1',
      userIds: new Set(['u3']),
    })
    expect(result.get('u3')).toBe('Dr. Gama')
  })

  it('fallback em user_profile quando não está em doctors', async () => {
    const { client } = fakeSupabase([
      { table: 'doctors', filters: [], data: [], error: null },
      {
        table: 'user_profile',
        filters: [],
        data: [{ user_id: 'u4', full_name: 'Receptionist X' }],
        error: null,
      },
    ])
    const result = await resolveAuthors(client as never, {
      tenantId: 't1',
      userIds: new Set(['u4']),
    })
    expect(result.get('u4')).toBe('Receptionist X')
  })

  it('user totalmente ausente: não entra no Map', async () => {
    const { client } = fakeSupabase([
      { table: 'doctors', filters: [], data: [], error: null },
      { table: 'user_profile', filters: [], data: [], error: null },
    ])
    const result = await resolveAuthors(client as never, {
      tenantId: 't1',
      userIds: new Set(['u5']),
    })
    expect(result.has('u5')).toBe(false)
    expect(result.size).toBe(0)
  })

  it('user_profile com full_name vazio é ignorado (fallback continua a fluir)', async () => {
    const { client } = fakeSupabase([
      { table: 'doctors', filters: [], data: [], error: null },
      {
        table: 'user_profile',
        filters: [],
        data: [{ user_id: 'u6', full_name: '   ' }],
        error: null,
      },
    ])
    const result = await resolveAuthors(client as never, {
      tenantId: 't1',
      userIds: new Set(['u6']),
    })
    expect(result.has('u6')).toBe(false)
  })

  it('userIds vazio: retorna Map vazio sem consulta', async () => {
    const { client, callLog } = fakeSupabase([])
    const result = await resolveAuthors(client as never, {
      tenantId: 't1',
      userIds: new Set(),
    })
    expect(result.size).toBe(0)
    expect(callLog.length).toBe(0)
  })

  it('combinação: short-circuit cobre alguns, doctors cobre o resto', async () => {
    const { client } = fakeSupabase([
      {
        table: 'doctors',
        filters: [],
        data: [{ user_id: 'u8', full_name: 'Dr. Theta' }],
        error: null,
      },
    ])
    const result = await resolveAuthors(client as never, {
      tenantId: 't1',
      userIds: new Set(['u7', 'u8']),
      knownDoctors: [{ user_id: 'u7', full_name: 'Dra. Zeta' }],
    })
    expect(result.get('u7')).toBe('Dra. Zeta')
    expect(result.get('u8')).toBe('Dr. Theta')
  })
})

describe('formatAuthorDisplay', () => {
  it('retorna nome quando user_id está no Map', () => {
    const map = new Map([['abc12345-aaaa-bbbb-cccc-ddddeeeeffff', 'Dr. Alfa']])
    expect(formatAuthorDisplay(map, 'abc12345-aaaa-bbbb-cccc-ddddeeeeffff')).toBe('Dr. Alfa')
  })

  it('fallback para 8 primeiros chars quando ausente', () => {
    const map = new Map<string, string>()
    expect(formatAuthorDisplay(map, 'abc12345-aaaa-bbbb-cccc-ddddeeeeffff')).toBe('abc12345')
  })
})
