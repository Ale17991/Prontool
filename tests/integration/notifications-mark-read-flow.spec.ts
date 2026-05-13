/**
 * T038 (Feature 012) — fluxo mark-read + mark-all-read + unread-count.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { generateUserNotifications } from '@/lib/core/notifications/generate'

describe('Feature 012 — mark-read flow', () => {
  let tenantId: string
  let userId: string
  let jwt: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('notif-mark')
    tenantId = t.tenantId
    const u = await seedUser(tenantId, 'admin')
    userId = u.userId
    jwt = mintJwt({ userId, email: u.email, tenantId, role: 'admin' })

    // Cria 2 tasks atrasadas para garantir notificações
    const sb = serviceClient()
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    await sb.from('tasks' as never).insert([
      {
        tenant_id: tenantId,
        title: 'Atrasada 1',
        due_date: yesterday,
        assigned_to: userId,
        assigned_by: userId,
        priority: 'alta',
        created_by: userId,
      },
      {
        tenant_id: tenantId,
        title: 'Atrasada 2',
        due_date: yesterday,
        assigned_to: userId,
        assigned_by: userId,
        priority: 'normal',
        created_by: userId,
      },
    ] as never)
    await generateUserNotifications(sb, { tenantId, userId })
  })

  it('GET /api/notificacoes retorna lista com unread_count + has_overdue', async () => {
    const { GET } = await import('@/app/api/notificacoes/route')
    const res = await GET(
      new Request('http://localhost/api/notificacoes', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      items: Array<{ id: string; is_read: boolean; type: string }>
      unread_count: number
      has_overdue: boolean
    }
    expect(body.unread_count).toBeGreaterThanOrEqual(2)
    expect(body.has_overdue).toBe(true)
  })

  it('PATCH /api/notificacoes/{id}/read marca como lida', async () => {
    const sb = serviceClient()
    const { data } = await sb
      .from('notifications' as never)
      .select('id')
      .eq('user_id', userId)
      .eq('is_read', false)
      .limit(1)
      .single()
    const notifId = (data as unknown as { id: string }).id

    const { PATCH } = await import('@/app/api/notificacoes/[id]/read/route')
    const res = await PATCH(
      new Request(`http://localhost/api/notificacoes/${notifId}/read`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${jwt}` },
      }),
      { params: { id: notifId } },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { is_read: boolean; read_at: string }
    expect(body.is_read).toBe(true)
    expect(body.read_at).not.toBeNull()
  })

  it('POST /api/notificacoes/mark-all-read zera unread', async () => {
    const { POST } = await import('@/app/api/notificacoes/mark-all-read/route')
    const res = await POST(
      new Request('http://localhost/api/notificacoes/mark-all-read', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    expect(res.status).toBe(200)

    const { GET } = await import('@/app/api/notificacoes/unread-count/route')
    const countRes = await GET(
      new Request('http://localhost/api/notificacoes/unread-count', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    const body = (await countRes.json()) as { count: number; has_overdue: boolean }
    expect(body.count).toBe(0)
    expect(body.has_overdue).toBe(false)
  })
})
