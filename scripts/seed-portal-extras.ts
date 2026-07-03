/**
 * Enriquece um paciente EXISTENTE (por nome) com dados ricos do portal:
 * medições (peso/IMC + metabólicas), metas, plano de treino, plano alimentar e
 * uma orientação — e habilita o portal + seções na clínica.
 *
 * Uso:
 *   pnpm tsx --env-file=.env.production.local scripts/seed-portal-extras.ts "Ambiente de testes" "Maria Oliveira"
 *   pnpm tsx --env-file=.env.local            scripts/seed-portal-extras.ts "clinica-demo" "Maria Demonstração"
 *
 * Args: [clínica (slug ou nome)] [nome do paciente]. Não é idempotente — cada
 * execução cria uma nova versão de treino/dieta (vira histórico) e novas metas.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listPatients } from '@/lib/core/patients/list'
import { createVitalSigns } from '@/lib/core/patient-medical/vital-signs'
import { recordMeasurement } from '@/lib/core/patient-portal/measurements'
import { setGoal } from '@/lib/core/patient-portal/goals'
import { createWorkoutPlan } from '@/lib/core/patient-portal/workout'
import { createDietPlan } from '@/lib/core/patient-portal/diet'
import { createCareNote } from '@/lib/core/patient-portal/care-notes'
import { updatePatientPortalConfig } from '@/lib/core/patient-portal/portal-config'

const CLINIC = process.argv[2] ?? 'Ambiente de testes'
const PATIENT_NAME = process.argv[3] ?? 'Maria Oliveira'

const monthsAgo = (n: number) => {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}
const monthsAgoIso = (n: number) => {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  d.setHours(10, 0, 0, 0)
  return d.toISOString()
}

const GLIC = [132, 128, 121, 115, 108, 99]
const HBA1C = [7.4, 7.1, 6.8, 6.5, 6.2, 5.9]
const COLEST = [225, 218, 210, 202, 195, 188]
const WEIGHT_START = 82
const HEIGHT_CM = 165

const WORKOUT = [
  {
    name: 'Treino A',
    focus: 'Peito e tríceps',
    exercises: [
      { name: 'Supino reto', sets: 4, reps: '10', loadKg: null, restSeconds: 90, notes: null },
      { name: 'Supino inclinado', sets: 3, reps: '12', loadKg: null, restSeconds: 60, notes: null },
      { name: 'Tríceps na corda', sets: 3, reps: '15', loadKg: null, restSeconds: 45, notes: null },
    ],
  },
  {
    name: 'Treino B',
    focus: 'Costas e bíceps',
    exercises: [
      { name: 'Puxada frontal', sets: 4, reps: '10', loadKg: null, restSeconds: 90, notes: null },
      { name: 'Remada curvada', sets: 3, reps: '12', loadKg: null, restSeconds: 60, notes: null },
      { name: 'Rosca direta', sets: 3, reps: '12', loadKg: null, restSeconds: 45, notes: null },
    ],
  },
  {
    name: 'Treino C',
    focus: 'Pernas',
    exercises: [
      { name: 'Agachamento', sets: 4, reps: '10', loadKg: null, restSeconds: 120, notes: null },
      { name: 'Leg press', sets: 3, reps: '12', loadKg: null, restSeconds: 90, notes: null },
      { name: 'Panturrilha', sets: 4, reps: '20', loadKg: null, restSeconds: 45, notes: null },
    ],
  },
]
const DIET = [
  {
    name: 'Café da manhã',
    timeLabel: '07:00',
    notes: null,
    items: [
      { food: '2 ovos mexidos', quantity: null, notes: null },
      { food: 'Pão integral', quantity: '1 fatia', notes: null },
      { food: 'Fruta', quantity: '1 un', notes: null },
    ],
  },
  {
    name: 'Almoço',
    timeLabel: '12:30',
    notes: null,
    items: [
      { food: 'Arroz integral', quantity: '4 col', notes: null },
      { food: 'Feijão', quantity: '1 concha', notes: null },
      { food: 'Frango grelhado', quantity: '150 g', notes: null },
      { food: 'Salada', quantity: 'à vontade', notes: null },
    ],
  },
  {
    name: 'Jantar',
    timeLabel: '19:30',
    notes: null,
    items: [
      { food: 'Omelete de legumes', quantity: null, notes: null },
      { food: 'Salada verde', quantity: 'à vontade', notes: null },
    ],
  },
]

async function resolveTenant(
  sb: SupabaseClient<Database>,
): Promise<{ id: string; slug: string | null }> {
  const bySlug = await sb.from('tenants').select('id, slug').eq('slug', CLINIC).maybeSingle()
  if (bySlug.data) return bySlug.data as { id: string; slug: string | null }
  const byName = await sb.from('tenants').select('id, slug').ilike('name', CLINIC).maybeSingle()
  if (byName.data) return byName.data as { id: string; slug: string | null }
  throw new Error(`Clínica não encontrada: "${CLINIC}"`)
}

async function main() {
  const sb = createSupabaseServiceClient() as unknown as SupabaseClient<Database>
  const tenant = await resolveTenant(sb)

  const { data: au } = await sb
    .from('user_tenants')
    .select('user_id')
    .eq('tenant_id', tenant.id)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  const actorUserId = (au as { user_id: string } | null)?.user_id
  if (!actorUserId) throw new Error('Sem usuário admin na clínica.')

  const list = await listPatients(sb, { tenantId: tenant.id, search: PATIENT_NAME, pageSize: 100 })
  const patient = list.items.find((p) =>
    p.fullName.toLowerCase().includes(PATIENT_NAME.toLowerCase()),
  )
  if (!patient) throw new Error(`Paciente "${PATIENT_NAME}" não encontrado na clínica.`)
  const patientId = patient.id
  console.log(
    `[extras] clínica ${CLINIC} (${tenant.id}) · paciente ${patient.fullName} (${patientId})`,
  )

  // portal + seções
  await updatePatientPortalConfig(sb, tenant.id, {
    patientPortalEnabled: true,
    publicBookingSlug: tenant.slug,
  })
  for (const section_key of ['orientacoes', 'treino', 'dieta']) {
    await sb
      .from('tenant_portal_sections' as never)
      .upsert({ tenant_id: tenant.id, section_key, enabled: true } as never, {
        onConflict: 'tenant_id,section_key',
      })
  }

  // medições (6 meses)
  for (let i = 5; i >= 0; i--) {
    const idx = 5 - i
    await createVitalSigns(sb, {
      tenantId: tenant.id,
      patientId,
      measuredAt: monthsAgoIso(i),
      weightGrams: Math.round((WEIGHT_START - idx * 1.3) * 1000),
      heightCm: HEIGHT_CM,
      actorUserId,
    })
    await recordMeasurement(sb, {
      tenantId: tenant.id,
      patientId,
      metricType: 'glicemia_jejum',
      value: GLIC[idx]!,
      measuredAt: monthsAgo(i),
      actorUserId,
    })
    await recordMeasurement(sb, {
      tenantId: tenant.id,
      patientId,
      metricType: 'hba1c',
      value: HBA1C[idx]!,
      measuredAt: monthsAgo(i),
      actorUserId,
    })
    await recordMeasurement(sb, {
      tenantId: tenant.id,
      patientId,
      metricType: 'colesterol_total',
      value: COLEST[idx]!,
      measuredAt: monthsAgo(i),
      actorUserId,
    })
  }

  // metas
  const currentWeight = WEIGHT_START - 5 * 1.3
  await setGoal(sb, {
    tenantId: tenant.id,
    patientId,
    metricType: 'peso_kg',
    direction: 'decrease',
    targetValue: Math.round((currentWeight - 4) * 10) / 10,
    actorUserId,
  })
  await setGoal(sb, {
    tenantId: tenant.id,
    patientId,
    metricType: 'glicemia_jejum',
    direction: 'decrease',
    targetValue: 90,
    actorUserId,
  })

  // treino + dieta + orientação
  await createWorkoutPlan(sb, {
    tenantId: tenant.id,
    patientId,
    title: 'Treino de hipertrofia — A/B/C',
    notes: 'Treinar 3x/semana, 1 dia de descanso entre treinos.',
    sessions: WORKOUT,
    actorUserId,
  })
  await createDietPlan(sb, {
    tenantId: tenant.id,
    patientId,
    title: 'Plano alimentar — manutenção',
    notes: 'Beber 2L de água/dia. Evitar açúcar.',
    meals: DIET,
    actorUserId,
  })
  await createCareNote(sb, {
    tenantId: tenant.id,
    patientId,
    body: 'Ótima evolução! Manter o treino e a dieta combinados e retornar em 60 dias com novos exames.',
    actorUserId,
  })

  const [yy, mm, dd] = (patient.birthDate ?? '').split('-')
  console.log('[extras] concluído.')
  console.log(`  Portal: /paciente/${tenant.slug ?? '<slug>'}`)
  console.log(
    `  Login: CPF ${patient.cpf || '(sem CPF)'} · Senha (nascimento) ${dd && mm && yy ? `${dd}${mm}${yy}` : '(sem data de nascimento — preencha no cadastro)'}`,
  )
}

main().catch((err) => {
  console.error('[extras] FALHOU:', err)
  process.exit(1)
})
