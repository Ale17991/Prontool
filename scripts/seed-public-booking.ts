/**
 * Povoa o AGENDAMENTO PÚBLICO de uma clínica: habilita o booking, publica cada
 * médico ativo (horários seg–sex 08:00–18:00, almoço 12:00–13:00) e atribui a
 * ele os procedimentos ativos da clínica (com duração).
 *
 * Uso:
 *   pnpm tsx --env-file=.env.production.local scripts/seed-public-booking.ts "Ambiente de testes"
 *   pnpm tsx --env-file=.env.local            scripts/seed-public-booking.ts "clinica-demo"
 *
 * Idempotente: usa upsert (re-rodar só atualiza). Atribui TODOS os procedimentos
 * a cada médico (cenário de demonstração) — ajuste depois no /configuracoes.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  getPublicBookingConfig,
  updatePublicBookingConfig,
  upsertPublishedDoctor,
  upsertPublishedProcedure,
} from '@/lib/core/public-booking/config'

const CLINIC = process.argv[2] ?? 'Ambiente de testes'
const DURATIONS = [30, 40, 60]

async function resolveTenant(sb: SupabaseClient<Database>): Promise<{ id: string; slug: string | null }> {
  const bySlug = await sb.from('tenants').select('id, slug').eq('slug', CLINIC).maybeSingle()
  if (bySlug.data) return bySlug.data as { id: string; slug: string | null }
  const byName = await sb.from('tenants').select('id, slug').ilike('name', CLINIC).maybeSingle()
  if (byName.data) return byName.data as { id: string; slug: string | null }
  throw new Error(`Clínica não encontrada: "${CLINIC}"`)
}

async function main() {
  const sb = createSupabaseServiceClient() as unknown as SupabaseClient<Database>
  const tenant = await resolveTenant(sb)

  const current = await getPublicBookingConfig(sb, tenant.id)
  const slug = current.config.publicBookingSlug ?? tenant.slug
  if (!slug) throw new Error('Clínica sem slug — defina um slug antes de habilitar o agendamento público.')

  await updatePublicBookingConfig(sb, tenant.id, {
    publicBookingSlug: slug,
    publicBookingEnabled: true,
    publicBookingMinHoursAdvance: 24,
    publicBookingMaxDaysAdvance: 30,
    publicBookingCancelMinHours: 6,
  })

  const { data: docRows } = await sb
    .from('doctors')
    .select('id, full_name')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('full_name', { ascending: true })
  const doctors = (docRows ?? []) as Array<{ id: string; full_name: string | null }>

  const { data: procRows } = await sb
    .from('procedures')
    .select('id, display_name')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('display_name', { ascending: true })
  const procedures = (procRows ?? []) as Array<{ id: string; display_name: string | null }>

  console.log(`[public-booking] clínica ${CLINIC} (${tenant.id}) · slug "${slug}"`)
  console.log(`  ${doctors.length} médico(s) ativo(s), ${procedures.length} procedimento(s) ativo(s)`)
  if (doctors.length === 0) throw new Error('Nenhum médico ativo na clínica — cadastre médicos primeiro.')
  if (procedures.length === 0) throw new Error('Nenhum procedimento ativo na clínica — cadastre procedimentos primeiro.')

  for (let i = 0; i < doctors.length; i++) {
    const d = doctors[i]!
    await upsertPublishedDoctor(sb, tenant.id, {
      doctorId: d.id,
      displayOrder: i,
      bio: null,
      availableWeekdays: [1, 2, 3, 4, 5],
      availableFrom: '08:00',
      availableUntil: '18:00',
      lunchBreakFrom: '12:00',
      lunchBreakUntil: '13:00',
    })
    for (let j = 0; j < procedures.length; j++) {
      const p = procedures[j]!
      const raw = (p.display_name ?? '').trim()
      const displayName = (raw.length >= 3 ? raw : 'Consulta').slice(0, 100)
      await upsertPublishedProcedure(sb, tenant.id, {
        doctorId: d.id,
        procedureId: p.id,
        displayName,
        durationMinutes: DURATIONS[j % DURATIONS.length]!,
        displayOrder: j,
      })
    }
    console.log(`  ✓ ${d.full_name ?? d.id} — ${procedures.length} procedimento(s) publicado(s)`)
  }

  console.log('[public-booking] concluído.')
  console.log(`  Página pública: /agendar/${slug}`)
}

main().catch((err) => {
  console.error('[public-booking] FALHOU:', err)
  process.exit(1)
})
