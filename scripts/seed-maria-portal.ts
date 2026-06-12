#!/usr/bin/env tsx
// @ts-nocheck — script de ops executado via tsx (sem type-check).
/**
 * Popula o PORTAL DO PACIENTE da "Maria Oliveira" (CPF 11122233396) no tenant
 * `ambiente-de-testes` para a demo: série temporal de TODOS os dados que a
 * página do paciente mostra com gráficos de evolução + plano de treino + dieta.
 *
 *   - vital_signs ............ peso/IMC/PA, 7 pontos (~6 meses), tendência de melhora
 *   - patient_measurements ... as 7 métricas endócrinas, 7 pontos cada
 *   - workout_plans .......... 1 plano de treino ativo (A/B/C)
 *   - diet_plans ............. 1 plano alimentar ativo
 *
 * Idempotente: pula o que já existe (métrica já lançada, plano ativo já criado).
 * Append-only respeitado (medições/sinais nunca são apagados — só acrescentados).
 *
 * Rodar:  pnpm tsx --env-file=.env.production.local scripts/seed-maria-portal.ts
 */
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createWorkoutPlan, getActiveWorkoutPlan } from '@/lib/core/patient-portal/workout'
import { createDietPlan, getActiveDietPlan } from '@/lib/core/patient-portal/diet'

const TENANT_SLUG = 'ambiente-de-testes'
const ADMIN_EMAIL = 'operations@homio.com.br'
const MARIA_CPF = '11122233396'
const POINTS = 7 // pontos no tempo (gráfico)

const sb: any = createSupabaseServiceClient()
const log = (m: string) => console.log(m)

/** Data YYYY-MM-DD de N pontos atrás, do mais antigo (k=0) ao mais recente. */
function dateAt(k: number): string {
  const d = new Date()
  d.setHours(9, 0, 0, 0)
  d.setDate(d.getDate() - (POINTS - 1 - k) * 26) // ~26 dias entre pontos
  return d.toISOString()
}
/** Interpola linearmente de `start` a `end` no ponto k, arredonda a `dp` casas. */
function lerp(start: number, end: number, k: number, dp = 1): number {
  const v = start + ((end - start) * k) / (POINTS - 1)
  return Number(v.toFixed(dp))
}

// Métricas endócrinas (chave, unidade, valor inicial, valor final) — todas
// dentro da faixa plausível do catálogo (0113) e com evolução de melhora.
const METRICS: Array<[string, string, number, number, number]> = [
  // [metric_type, unit, start, end, casas]
  ['glicemia_jejum', 'mg/dL', 142, 106, 0],
  ['hba1c', '%', 8.4, 6.6, 1],
  ['circunferencia_abdominal', 'cm', 104, 92, 0],
  ['colesterol_total', 'mg/dL', 232, 186, 0],
  ['ldl', 'mg/dL', 158, 116, 0],
  ['hdl', 'mg/dL', 38, 50, 0], // sobe = melhora
  ['triglicerides', 'mg/dL', 224, 150, 0],
]

async function main() {
  const t = await sb.from('tenants').select('id').eq('slug', TENANT_SLUG).maybeSingle()
  const tenantId = t.data?.id
  if (!tenantId) throw new Error(`tenant ${TENANT_SLUG} não encontrado`)

  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY é obrigatória (mesma chave do app)')

  const users = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
  const ACTOR = users.data?.users.find((u: any) => u.email === ADMIN_EMAIL)?.id
  if (!ACTOR) throw new Error(`usuário ${ADMIN_EMAIL} não encontrado`)

  const found = await sb.rpc('public_booking_find_patient_by_cpf', {
    p_tenant_id: tenantId,
    p_cpf: MARIA_CPF,
    p_key: key,
  })
  if (found.error) throw new Error(`lookup Maria: ${found.error.message}`)
  const maria = (found.data ?? [])[0]
  if (!maria?.patient_id) throw new Error(`Maria (CPF ${MARIA_CPF}) não encontrada — rode o seed-demo-cloud antes`)
  const patientId = maria.patient_id
  log(`tenant=${tenantId}  maria=${patientId}  actor=${ACTOR}`)

  // ---- sinais vitais (peso/IMC/PA) — série temporal ----------------------
  {
    const existing = await sb
      .from('vital_signs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('patient_id', patientId)
    if ((existing.count ?? 0) >= POINTS) {
      log(`  vital_signs: já tem ${existing.count} (pulado)`)
    } else {
      const rows = Array.from({ length: POINTS }, (_, k) => ({
        tenant_id: tenantId,
        patient_id: patientId,
        measured_by: ACTOR,
        measured_at: dateAt(k),
        height_cm: 165, // fixo → IMC (gerado) cai junto com o peso
        weight_grams: Math.round(lerp(82, 74, k, 1) * 1000), // 82kg → 74kg
        systolic_bp: Math.round(lerp(138, 122, k, 0)),
        diastolic_bp: Math.round(lerp(90, 80, k, 0)),
        heart_rate: Math.round(lerp(82, 72, k, 0)),
        temperature_celsius: 36.5,
        oxygen_saturation: 98,
      }))
      const r = await sb.from('vital_signs').insert(rows)
      if (r.error) throw new Error(`vital_signs: ${r.error.message}`)
      log(`  vital_signs: +${rows.length} (peso 82→74kg, IMC ~30→27)`)
    }
  }

  // ---- medições metabólicas (7 métricas × 7 pontos) ----------------------
  {
    const have = await sb
      .from('patient_measurements')
      .select('metric_type')
      .eq('tenant_id', tenantId)
      .eq('patient_id', patientId)
    const already = new Set((have.data ?? []).map((r: any) => r.metric_type))
    const rows: any[] = []
    for (const [metric_type, unit, start, end, dp] of METRICS) {
      if (already.has(metric_type)) continue // já lançada (seed-demo) — não duplica
      for (let k = 0; k < POINTS; k++) {
        rows.push({
          tenant_id: tenantId,
          patient_id: patientId,
          created_by_user_id: ACTOR,
          metric_type,
          unit,
          value: lerp(start, end, k, dp),
          measured_at: dateAt(k).slice(0, 10),
        })
      }
    }
    if (rows.length) {
      const r = await sb.from('patient_measurements').insert(rows)
      if (r.error) throw new Error(`patient_measurements: ${r.error.message}`)
      const novas = METRICS.filter(([m]) => !already.has(m)).map(([m]) => m)
      log(`  medições: +${rows.length} (${novas.join(', ')})`)
    } else {
      log('  medições: todas as métricas já existiam (pulado)')
    }
  }

  // ---- plano de treino ----------------------------------------------------
  {
    const active = await getActiveWorkoutPlan(sb, tenantId, patientId)
    if (active) {
      log(`  treino: já tem plano ativo "${active.title}" (pulado)`)
    } else {
      const { id } = await createWorkoutPlan(sb, {
        tenantId,
        patientId,
        actorUserId: ACTOR,
        title: 'Treino — Emagrecimento e condicionamento (ABC)',
        notes: 'Progredir carga a cada 2 semanas. Manter cadência e respiração. 3x por semana.',
        sessions: [
          {
            name: 'Treino A — Inferiores',
            focus: 'Pernas e glúteos',
            exercises: [
              { name: 'Agachamento livre', sets: 4, reps: '12', loadKg: 20, restSeconds: 60, notes: 'Descer até paralela' },
              { name: 'Leg press 45°', sets: 4, reps: '12', loadKg: 80, restSeconds: 60, notes: null },
              { name: 'Cadeira extensora', sets: 3, reps: '15', loadKg: 30, restSeconds: 45, notes: null },
              { name: 'Mesa flexora', sets: 3, reps: '15', loadKg: 25, restSeconds: 45, notes: null },
              { name: 'Panturrilha em pé', sets: 4, reps: '20', loadKg: 40, restSeconds: 30, notes: null },
            ],
          },
          {
            name: 'Treino B — Superiores (empurrar)',
            focus: 'Peito, ombro e tríceps',
            exercises: [
              { name: 'Supino reto com halteres', sets: 4, reps: '12', loadKg: 12, restSeconds: 60, notes: null },
              { name: 'Desenvolvimento de ombros', sets: 3, reps: '12', loadKg: 8, restSeconds: 60, notes: null },
              { name: 'Crucifixo na máquina', sets: 3, reps: '15', loadKg: 25, restSeconds: 45, notes: null },
              { name: 'Tríceps na polia', sets: 3, reps: '15', loadKg: 20, restSeconds: 45, notes: null },
            ],
          },
          {
            name: 'Treino C — Superiores (puxar) + core',
            focus: 'Costas, bíceps e abdômen',
            exercises: [
              { name: 'Puxada frente na polia', sets: 4, reps: '12', loadKg: 35, restSeconds: 60, notes: null },
              { name: 'Remada baixa', sets: 4, reps: '12', loadKg: 40, restSeconds: 60, notes: null },
              { name: 'Rosca direta', sets: 3, reps: '12', loadKg: 10, restSeconds: 45, notes: null },
              { name: 'Prancha abdominal', sets: 3, reps: '40s', loadKg: null, restSeconds: 30, notes: 'Manter quadril alinhado' },
              { name: 'Esteira (caminhada inclinada)', sets: 1, reps: '20 min', loadKg: null, restSeconds: null, notes: 'Inclinação 6%, ritmo moderado' },
            ],
          },
        ],
      })
      log(`  treino: plano criado (${id})`)
    }
  }

  // ---- plano alimentar ----------------------------------------------------
  {
    const active = await getActiveDietPlan(sb, tenantId, patientId)
    if (active) {
      log(`  dieta: já tem plano ativo "${active.title}" (pulado)`)
    } else {
      const { id } = await createDietPlan(sb, {
        tenantId,
        patientId,
        actorUserId: ACTOR,
        title: 'Plano alimentar — Low carb moderado (~1600 kcal)',
        notes: 'Beber 2 L de água/dia. Evitar açúcar e ultraprocessados. Ajustar porções conforme fome.',
        meals: [
          {
            name: 'Café da manhã',
            timeLabel: '07:00',
            notes: null,
            items: [
              { food: 'Ovos mexidos', quantity: '2 unidades', notes: null },
              { food: 'Pão integral', quantity: '1 fatia', notes: null },
              { food: 'Café sem açúcar', quantity: '1 xícara', notes: 'Adoçante se necessário' },
              { food: 'Mamão', quantity: '1 fatia', notes: null },
            ],
          },
          {
            name: 'Lanche da manhã',
            timeLabel: '10:00',
            notes: null,
            items: [
              { food: 'Iogurte natural', quantity: '1 pote (170g)', notes: null },
              { food: 'Castanhas', quantity: '1 punhado (20g)', notes: null },
            ],
          },
          {
            name: 'Almoço',
            timeLabel: '12:30',
            notes: null,
            items: [
              { food: 'Frango grelhado', quantity: '120 g', notes: null },
              { food: 'Arroz integral', quantity: '4 colheres de sopa', notes: null },
              { food: 'Feijão', quantity: '1 concha', notes: null },
              { food: 'Salada de folhas + legumes', quantity: 'à vontade', notes: 'Azeite 1 fio' },
            ],
          },
          {
            name: 'Lanche da tarde',
            timeLabel: '16:00',
            notes: null,
            items: [
              { food: 'Maçã', quantity: '1 unidade', notes: null },
              { food: 'Queijo branco', quantity: '2 fatias', notes: null },
            ],
          },
          {
            name: 'Jantar',
            timeLabel: '19:30',
            notes: null,
            items: [
              { food: 'Omelete com legumes', quantity: '2 ovos', notes: null },
              { food: 'Salada variada', quantity: 'à vontade', notes: null },
              { food: 'Batata-doce', quantity: '1 pequena', notes: null },
            ],
          },
          {
            name: 'Ceia',
            timeLabel: '22:00',
            notes: null,
            items: [{ food: 'Chá de camomila', quantity: '1 xícara', notes: 'Sem açúcar' }],
          },
        ],
      })
      log(`  dieta: plano criado (${id})`)
    }
  }

  log('\n✅ portal da Maria populado. Faça login no portal com CPF 11122233396 e data de nascimento 12/03/1985.')
}

main().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
