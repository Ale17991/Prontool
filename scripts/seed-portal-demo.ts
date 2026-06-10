/**
 * Seed de DEMONSTRAÇÃO do Portal do Paciente.
 *
 * Cria pacientes-demo ricos (PII completa + série de peso/IMC + métricas
 * metabólicas com tendência + atendimentos + orientações) numa clínica, para
 * a tela do portal ficar cheia em demonstrações.
 *
 * Uso:
 *   pnpm tsx --env-file=.env.local            scripts/seed-portal-demo.ts "clinica-demo"
 *   pnpm tsx --env-file=.env.production.local scripts/seed-portal-demo.ts "Ambiente de testes"
 *
 * O argumento é o SLUG ou o NOME da clínica (default: "Ambiente de testes").
 * NÃO é idempotente: cada execução cria novos pacientes "(DEMO)". Rode uma vez.
 * Imprime, ao final, o login de portal de cada paciente (slug + CPF + nascimento).
 */
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createPatientManually } from '@/lib/core/patients/create-manual'
import { createVitalSigns } from '@/lib/core/patient-medical/vital-signs'
import { recordMeasurement } from '@/lib/core/patient-portal/measurements'
import { createAppointmentManually } from '@/lib/core/appointments/create-manual'
import { createCareNote } from '@/lib/core/patient-portal/care-notes'
import { setGoal } from '@/lib/core/patient-portal/goals'
import { createWorkoutPlan } from '@/lib/core/patient-portal/workout'
import { createDietPlan } from '@/lib/core/patient-portal/diet'
import { updatePatientPortalConfig } from '@/lib/core/patient-portal/portal-config'

const DEMO_WORKOUT_SESSIONS = [
  { name: 'Treino A', focus: 'Peito e tríceps', exercises: [
    { name: 'Supino reto', sets: 4, reps: '10', loadKg: null, restSeconds: 90, notes: null },
    { name: 'Supino inclinado com halteres', sets: 3, reps: '12', loadKg: null, restSeconds: 60, notes: null },
    { name: 'Tríceps na corda', sets: 3, reps: '15', loadKg: null, restSeconds: 45, notes: null },
  ]},
  { name: 'Treino B', focus: 'Costas e bíceps', exercises: [
    { name: 'Puxada frontal', sets: 4, reps: '10', loadKg: null, restSeconds: 90, notes: null },
    { name: 'Remada curvada', sets: 3, reps: '12', loadKg: null, restSeconds: 60, notes: null },
    { name: 'Rosca direta', sets: 3, reps: '12', loadKg: null, restSeconds: 45, notes: null },
  ]},
  { name: 'Treino C', focus: 'Pernas', exercises: [
    { name: 'Agachamento livre', sets: 4, reps: '10', loadKg: null, restSeconds: 120, notes: null },
    { name: 'Leg press', sets: 3, reps: '12', loadKg: null, restSeconds: 90, notes: null },
    { name: 'Panturrilha em pé', sets: 4, reps: '20', loadKg: null, restSeconds: 45, notes: null },
  ]},
]

const DEMO_DIET_MEALS = [
  { name: 'Café da manhã', timeLabel: '07:00', notes: null, items: [
    { food: '2 ovos mexidos', quantity: null, notes: null },
    { food: 'Pão integral', quantity: '1 fatia', notes: null },
    { food: 'Fruta', quantity: '1 unidade', notes: null },
  ]},
  { name: 'Almoço', timeLabel: '12:30', notes: null, items: [
    { food: 'Arroz integral', quantity: '4 col. sopa', notes: null },
    { food: 'Feijão', quantity: '1 concha', notes: null },
    { food: 'Frango grelhado', quantity: '150 g', notes: null },
    { food: 'Salada', quantity: 'à vontade', notes: null },
  ]},
  { name: 'Lanche', timeLabel: '16:00', notes: null, items: [
    { food: 'Iogurte natural', quantity: '1 pote', notes: null },
    { food: 'Castanhas', quantity: '1 punhado', notes: null },
  ]},
  { name: 'Jantar', timeLabel: '19:30', notes: null, items: [
    { food: 'Omelete de legumes', quantity: null, notes: null },
    { food: 'Salada verde', quantity: 'à vontade', notes: null },
  ]},
]
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

type SB = SupabaseClient<Database>

const TARGET = process.argv[2] ?? 'Ambiente de testes'

/** Data N meses atrás, YYYY-MM-DD. */
function monthsAgo(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}
function monthsAgoIso(n: number, hour = 10): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

interface DemoPatient {
  fullName: string
  cpf: string
  birthDate: string
  sex: 'feminino' | 'masculino'
  phone: string
  email: string
  heightCm: number
  weightStartKg: number // peso 5 meses atrás (cai ao longo do tempo)
  glic: number[] // glicemia jejum, 6 leituras (antiga→recente)
  hba1c: number[]
  cintura: number[]
  colesterol: number[]
  orientacoes: string[]
}

const PATIENTS: DemoPatient[] = [
  {
    fullName: 'Maria Demonstração (DEMO)',
    cpf: '11122233396',
    birthDate: '1985-03-12',
    sex: 'feminino',
    phone: '11988880001',
    email: 'maria.demo@exemplo.com',
    heightCm: 162,
    weightStartKg: 78,
    glic: [132, 128, 121, 115, 108, 99],
    hba1c: [7.4, 7.1, 6.8, 6.5, 6.2, 5.9],
    cintura: [98, 96, 94, 92, 90, 88],
    colesterol: [225, 218, 210, 202, 195, 188],
    orientacoes: [
      'Manter caminhada de 30 minutos, 5x por semana. Reduzir açúcar e refrigerantes.',
      'Ótima evolução da glicada! Continuar a dieta combinada e retornar em 60 dias com novos exames.',
    ],
  },
  {
    fullName: 'João Exemplo (DEMO)',
    cpf: '22233344407',
    birthDate: '1978-07-25',
    sex: 'masculino',
    phone: '11988880002',
    email: 'joao.demo@exemplo.com',
    heightCm: 176,
    weightStartKg: 94,
    glic: [118, 116, 113, 110, 106, 101],
    hba1c: [6.9, 6.7, 6.5, 6.3, 6.1, 5.9],
    cintura: [108, 106, 104, 103, 101, 99],
    colesterol: [240, 233, 226, 219, 210, 200],
    orientacoes: [
      'Iniciar musculação 2x/semana e reduzir consumo de álcool. Beber 2L de água por dia.',
    ],
  },
  {
    fullName: 'Ana Teste (DEMO)',
    cpf: '33344455518',
    birthDate: '1992-11-03',
    sex: 'feminino',
    phone: '11988880003',
    email: 'ana.demo@exemplo.com',
    heightCm: 168,
    weightStartKg: 70,
    glic: [99, 97, 96, 94, 93, 91],
    hba1c: [5.8, 5.7, 5.6, 5.6, 5.5, 5.4],
    cintura: [84, 83, 82, 81, 80, 79],
    colesterol: [195, 190, 186, 182, 178, 174],
    orientacoes: [
      'Manter alimentação equilibrada e exames de rotina anuais. Excelentes resultados.',
    ],
  },
]

async function resolveTenant(sb: SB): Promise<{ id: string; slug: string | null }> {
  // tenta por slug, depois por nome (case-insensitive).
  const bySlug = await sb.from('tenants').select('id, slug').eq('slug', TARGET).maybeSingle()
  if (bySlug.data) return bySlug.data as { id: string; slug: string | null }
  const byName = await sb.from('tenants').select('id, slug').ilike('name', TARGET).maybeSingle()
  if (byName.data) return byName.data as { id: string; slug: string | null }
  throw new Error(`Clínica não encontrada por slug nem nome: "${TARGET}"`)
}

async function adminUserId(sb: SB, tenantId: string): Promise<string> {
  const { data } = await sb
    .from('user_tenants')
    .select('user_id, role')
    .eq('tenant_id', tenantId)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  if (!data) throw new Error('Nenhum usuário admin nesta clínica para usar como autor.')
  return (data as { user_id: string }).user_id
}

/** Garante portal habilitado + slug. Best-effort (não derruba o seed). */
async function ensurePortal(sb: SB, tenantId: string, tenantSlug: string | null): Promise<string | null> {
  // Preserva o slug do portal se a clínica já tiver um; só usa o slug do tenant
  // como fallback (não sobrescreve configuração de produção existente).
  const existing = await sb
    .from('tenant_clinic_profile')
    .select('public_booking_slug')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const slug = (existing.data as { public_booking_slug: string | null } | null)?.public_booking_slug ?? tenantSlug
  try {
    await updatePatientPortalConfig(sb, tenantId, {
      patientPortalEnabled: true,
      publicBookingSlug: slug,
    })
    // habilita seções extras p/ a demo (orientações + treino + dieta; default off).
    for (const section_key of ['orientacoes', 'treino', 'dieta']) {
      await sb
        .from('tenant_portal_sections' as never)
        .upsert(
          { tenant_id: tenantId, section_key, enabled: true } as never,
          { onConflict: 'tenant_id,section_key' },
        )
    }
  } catch (err) {
    console.warn(`[portal] não consegui habilitar o portal/seção automaticamente: ${String(err)}`)
  }
  return slug
}

/** Reusa ou cria um médico-demo. */
async function ensureDemoDoctor(sb: SB, tenantId: string, actorUserId: string): Promise<string> {
  const crm = 'DEMO-PORTAL'
  const existing = await sb
    .from('doctors')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('crm', crm)
    .maybeSingle()
  if (existing.data) return (existing.data as { id: string }).id
  const { createDoctor } = await import('@/lib/core/doctors/create')
  const created = await createDoctor(sb, {
    tenantId,
    fullName: 'Dr. Demonstração (DEMO)',
    crm,
    role: 'Médico',
    councilName: 'CRM',
    councilNumber: '00000',
    councilState: 'SP',
    paymentMode: 'comissionado',
    initialPercentageBps: 4000,
    initialValidFrom: monthsAgo(12),
    initialReason: 'Médico de demonstração do portal',
    actorUserId,
  })
  return created.id
}

/** Reusa ou cria um procedimento-demo particular (sem dependência de TUSS). */
async function ensureDemoProcedure(sb: SB, tenantId: string, actorUserId: string): Promise<string> {
  const displayName = 'Consulta (DEMO portal)'
  const existing = await sb
    .from('procedures')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('display_name', displayName)
    .maybeSingle()
  if (existing.data) return (existing.data as { id: string }).id
  const { data, error } = await sb
    .from('procedures')
    .insert({
      tenant_id: tenantId,
      tuss_code: null,
      display_name: displayName,
      default_amount_cents: 30000,
      covered_by_plan: false,
      is_unlisted: true,
      active: true,
      created_by: actorUserId,
    } as never)
    .select('id')
    .single()
  if (error) throw new Error(`criar procedimento demo: ${error.message}`)
  return (data as { id: string }).id
}

async function seedPatient(
  sb: SB,
  ctx: { tenantId: string; actorUserId: string; doctorId: string; procedureId: string; patientIndex: number },
  p: DemoPatient,
): Promise<void> {
  const { patientId } = await createPatientManually(sb, {
    tenantId: ctx.tenantId,
    actorUserId: ctx.actorUserId,
    fullName: p.fullName,
    cpf: p.cpf,
    birthDate: p.birthDate,
    sex: p.sex,
    phone: p.phone,
    email: p.email,
  })

  // 6 leituras mensais (5 meses atrás → hoje): peso caindo + IMC computado.
  for (let i = 5; i >= 0; i--) {
    const idx = 5 - i
    const weightKg = p.weightStartKg - idx * 1.2
    await createVitalSigns(sb, {
      tenantId: ctx.tenantId,
      patientId,
      measuredAt: monthsAgoIso(i),
      weightGrams: Math.round(weightKg * 1000),
      heightCm: p.heightCm,
      actorUserId: ctx.actorUserId,
    })
    await recordMeasurement(sb, { tenantId: ctx.tenantId, patientId, metricType: 'glicemia_jejum', value: p.glic[idx]!, measuredAt: monthsAgo(i), actorUserId: ctx.actorUserId })
    await recordMeasurement(sb, { tenantId: ctx.tenantId, patientId, metricType: 'hba1c', value: p.hba1c[idx]!, measuredAt: monthsAgo(i), actorUserId: ctx.actorUserId })
    await recordMeasurement(sb, { tenantId: ctx.tenantId, patientId, metricType: 'circunferencia_abdominal', value: p.cintura[idx]!, measuredAt: monthsAgo(i), actorUserId: ctx.actorUserId })
    await recordMeasurement(sb, { tenantId: ctx.tenantId, patientId, metricType: 'colesterol_total', value: p.colesterol[idx]!, measuredAt: monthsAgo(i), actorUserId: ctx.actorUserId })
  }

  // 2 atendimentos (particular, valor override p/ não depender de price_version).
  // Horário distinto por paciente p/ não duplo-agendar o mesmo médico-demo.
  const apptMonths = [4, 1]
  for (let j = 0; j < apptMonths.length; j++) {
    const hour = 8 + ctx.patientIndex * 4 + j * 2
    await createAppointmentManually(sb, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.actorUserId,
      patientId,
      doctorId: ctx.doctorId,
      procedures: [{ procedureId: ctx.procedureId, planId: null, amountCentsOverride: 30000 }],
      appointmentAt: monthsAgoIso(apptMonths[j]!, hour),
      durationMinutes: 30,
      addToTreatmentPlan: false,
    })
  }

  for (const body of p.orientacoes) {
    await createCareNote(sb, { tenantId: ctx.tenantId, patientId, body, actorUserId: ctx.actorUserId })
  }

  // Metas (Dash de Metas): peso e glicemia a reduzir.
  const currentWeight = p.weightStartKg - 5 * 1.2
  await setGoal(sb, { tenantId: ctx.tenantId, patientId, metricType: 'peso_kg', direction: 'decrease', targetValue: Math.round((currentWeight - 4) * 10) / 10, actorUserId: ctx.actorUserId })
  await setGoal(sb, { tenantId: ctx.tenantId, patientId, metricType: 'glicemia_jejum', direction: 'decrease', targetValue: 90, actorUserId: ctx.actorUserId })

  // Planos de treino e dieta (aparecem nas colunas laterais do portal).
  await createWorkoutPlan(sb, { tenantId: ctx.tenantId, patientId, title: 'Treino de hipertrofia — A/B/C', notes: 'Treinar 3x por semana, com 1 dia de descanso entre os treinos.', sessions: DEMO_WORKOUT_SESSIONS, actorUserId: ctx.actorUserId })
  await createDietPlan(sb, { tenantId: ctx.tenantId, patientId, title: 'Plano alimentar — manutenção', notes: 'Beber 2L de água por dia. Evitar açúcar e ultraprocessados.', meals: DEMO_DIET_MEALS, actorUserId: ctx.actorUserId })

  const [d, mo, y] = p.birthDate.split('-').reverse() // YYYY-MM-DD → [DD, MM, YYYY]
  console.log(`  ✓ ${p.fullName}  ·  login: CPF ${p.cpf} · nascimento ${d}${mo}${y}`)
}

async function main() {
  const sb = createSupabaseServiceClient()
  const tenant = await resolveTenant(sb)
  const actorUserId = await adminUserId(sb, tenant.id)
  console.log(`[seed-portal-demo] clínica: ${TARGET} (${tenant.id})`)

  const slug = await ensurePortal(sb, tenant.id, tenant.slug)
  const doctorId = await ensureDemoDoctor(sb, tenant.id, actorUserId)
  const procedureId = await ensureDemoProcedure(sb, tenant.id, actorUserId)

  for (let i = 0; i < PATIENTS.length; i++) {
    await seedPatient(sb, { tenantId: tenant.id, actorUserId, doctorId, procedureId, patientIndex: i }, PATIENTS[i]!)
  }

  console.log('\n[seed-portal-demo] concluído.')
  console.log(`  Portal: /paciente/${slug ?? '<defina o slug da clínica>'}`)
  console.log('  Senha do portal = data de nascimento (DDMMAAAA). Login = CPF.')
}

main().catch((err) => {
  console.error('[seed-portal-demo] FALHOU:', err)
  process.exit(1)
})
