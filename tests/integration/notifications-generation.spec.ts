/**
 * T037 (Feature 012) — geração de notificações + idempotência.
 *
 * Cobre: tarefa hoje, tarefa atrasada, idempotência (2 chamadas seguidas).
 * Não cobre atendimentos (precisa de seed de atendimento, mais pesado) nem
 * aniversariantes (decifração) — esses dependem de fixtures cifradas.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { generateUserNotifications } from '@/lib/core/notifications/generate'

describe('Feature 012 — generate_user_notifications', () => {
  let tenantId: string
  let userId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('notif-gen')
    tenantId = t.tenantId
    const u = await seedUser(tenantId, 'admin')
    userId = u.userId
  })

  it('gera tarefa para hoje + tarefa atrasada, idempotente', async () => {
    const sb = serviceClient()
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

    // Seed 2 tasks: 1 hoje, 1 atrasada
    await sb.from('tasks' as never).insert([
      {
        tenant_id: tenantId,
        title: 'Tarefa de hoje',
        due_date: today,
        assigned_to: userId,
        assigned_by: userId,
        priority: 'normal',
        created_by: userId,
      },
      {
        tenant_id: tenantId,
        title: 'Tarefa atrasada',
        due_date: yesterday,
        assigned_to: userId,
        assigned_by: userId,
        priority: 'alta',
        created_by: userId,
      },
    ] as never)

    // Primeira execução: gera 1 'tarefa' + 1 'tarefa_atrasada'
    const r1 = await generateUserNotifications(sb, { tenantId, userId })
    expect(r1.inserted_tarefa).toBe(1)
    expect(r1.inserted_tarefa_atrasada).toBe(1)

    // Segunda execução (idempotência): NÃO duplica
    const r2 = await generateUserNotifications(sb, { tenantId, userId })
    expect(r2.inserted_tarefa).toBe(0)
    expect(r2.inserted_tarefa_atrasada).toBe(0)

    // Verifica que existem exatamente 2 notificações no DB
    const { data } = await sb
      .from('notifications' as never)
      .select('id, type')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
    const rows = (data ?? []) as unknown as Array<{ type: string }>
    expect(rows.filter((r) => r.type === 'tarefa').length).toBe(1)
    expect(rows.filter((r) => r.type === 'tarefa_atrasada').length).toBe(1)
  })

  it('não gera nada quando não há eventos de hoje', async () => {
    const t = await seedTenant('notif-gen-empty')
    const u = await seedUser(t.tenantId, 'admin')
    const sb = serviceClient()
    const r = await generateUserNotifications(sb, { tenantId: t.tenantId, userId: u.userId })
    expect(r.inserted_tarefa).toBe(0)
    expect(r.inserted_tarefa_atrasada).toBe(0)
    expect(r.inserted_atendimento).toBe(0)
  })
})
