#!/usr/bin/env tsx
// @ts-nocheck — script de ops executado via tsx (sem type-check); índices de
// arrays usam noUncheckedIndexedAccess que não se aplica a um seed determinístico.
/**
 * Seed de DEMONSTRAÇÃO para o tenant `ambiente-de-testes` (operations@homio.com.br).
 *
 * Idempotente: cada seção só cria o que falta para atingir a meta (≥5 de cada).
 * Reusa funções de domínio (pacientes/atendimentos/pagamentos). Inserts diretos
 * no resto, com erros reais à mostra.
 *
 * Pacientes exigem PATIENT_DATA_ENCRYPTION_KEY (a MESMA do app em produção).
 * Sem ela, pula pacientes e tudo que depende deles (e avisa).
 *
 * Rodar:  pnpm tsx --env-file=.env.production.local scripts/seed-demo-cloud.ts
 */
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createPatientManually } from '@/lib/core/patients/create-manual'
import { createAppointmentManually } from '@/lib/core/appointments/create-manual'
import { createPaymentRecord } from '@/lib/core/payments/create'
import { markAppointmentRealized } from '@/lib/core/appointments/mark-realized'

const TENANT_SLUG = 'ambiente-de-testes'
const ADMIN_EMAIL = 'operations@homio.com.br'
const PORTAL_SLUG = 'homio-demo'
const HAS_KEY = Boolean(process.env.PATIENT_DATA_ENCRYPTION_KEY)

const sb: any = createSupabaseServiceClient()
const log = (m: string) => console.log(m)
async function section(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (e) { console.error(`❌ [${name}] ${(e as Error).message}`) }
}
function ok(label: string, r: { error: any }) {
  if (r.error) console.error(`   ⚠ ${label}: ${r.error.message}`)
}
async function countOf(table: string, tenantId: string): Promise<number> {
  const r = await sb.from(table).select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId)
  return r.error ? 0 : (r.count ?? 0)
}
const iso = (d: Date) => d.toISOString()
const daysFromNow = (days: number, hour = 9, min = 0) => {
  const d = new Date(); d.setHours(hour, min, 0, 0); d.setDate(d.getDate() + days); return d
}

const PLANS = [
  { name: 'Unimed', tax: 300 }, { name: 'Bradesco Saúde', tax: 300 },
  { name: 'SulAmérica', tax: 300 }, { name: 'Amil', tax: 300 },
  { name: 'Hapvida', tax: 300 }, { name: 'Particular', tax: 0 },
]
// tuss resolvido em runtime via `kw` (descrição) contra o catálogo real.
const PROCS = [
  { kw: 'Consulta em consultório', name: 'Consulta médica', amount: 30000, covered: true },
  { kw: 'Consulta em domicílio', name: 'Consulta domiciliar', amount: 35000, covered: true },
  { kw: 'Holter de 24 horas', name: 'Holter 24 horas', amount: 25000, covered: true },
  { kw: 'Hemograma com contagem', name: 'Hemograma completo', amount: 8000, covered: false },
  { kw: 'Eletrocardiograma', name: 'Eletrocardiograma (ECG)', amount: 12000, covered: true },
  { kw: 'Ultrassonografia', name: 'Ultrassonografia', amount: 18000, covered: true },
]
const DOCTORS = [
  { full: 'Dra. Ana Silva', crm: 'CRM/SP 123456', spec: 'Cardiologia', bps: 5000 },
  { full: 'Dr. Bruno Costa', crm: 'CRM/SP 234567', spec: 'Endocrinologia', bps: 5000 },
  { full: 'Dra. Carla Mendes', crm: 'CRM/SP 345678', spec: 'Clínica Geral', bps: 4500 },
  { full: 'Dr. Diego Rocha', crm: 'CRM/SP 456789', spec: 'Ortopedia', bps: 4500 },
  { full: 'Dra. Elena Souza', crm: 'CRM/SP 567890', spec: 'Dermatologia', bps: 4000 },
  { full: 'Dr. Felipe Lima', crm: 'CRM/SP 678901', spec: 'Pediatria', bps: 4000 },
]
const PATIENTS = [
  { name: 'Maria Oliveira', cpf: '11122233396', birth: '1985-03-12', sex: 'feminino', phone: '11988880001' },
  { name: 'João Santos', cpf: '22233344407', birth: '1978-07-25', sex: 'masculino', phone: '11988880002' },
  { name: 'Ana Paula Ferreira', cpf: '33344455518', birth: '1992-11-03', sex: 'feminino', phone: '11988880003' },
  { name: 'Carlos Eduardo Lima', cpf: '44455566629', birth: '1969-01-18', sex: 'masculino', phone: '11988880004' },
  { name: 'Fernanda Costa', cpf: '55566677730', birth: '1990-09-09', sex: 'feminino', phone: '11988880005' },
  { name: 'Ricardo Almeida', cpf: '66677788841', birth: '1983-05-22', sex: 'masculino', phone: '11988880006' },
  { name: 'Juliana Rodrigues', cpf: '77788899952', birth: '1995-12-30', sex: 'feminino', phone: '11988880007' },
  { name: 'Paulo Henrique Souza', cpf: '88899900063', birth: '1974-08-14', sex: 'masculino', phone: '11988880008' },
]
const CIDS = [
  ['E11', 'Diabetes mellitus tipo 2'], ['I10', 'Hipertensão essencial (primária)'],
  ['E78', 'Distúrbios do metabolismo de lipoproteínas'], ['E66', 'Obesidade'],
  ['J45', 'Asma'], ['M54', 'Dorsalgia'], ['K21', 'Doença de refluxo gastroesofágico'],
]
const ALLERGIES = [
  ['Dipirona', 'moderada'], ['Penicilina', 'grave'], ['Ácido acetilsalicílico', 'leve'],
  ['Látex', 'moderada'], ['Frutos do mar', 'grave'], ['Contraste iodado', 'moderada'],
]
const HISTORY = [
  ['antecedente_familiar', 'Pai com infarto agudo do miocárdio aos 58 anos'],
  ['habito', 'Ex-tabagista (10 cigarros/dia por 15 anos)'],
  ['cirurgia', 'Apendicectomia em 2010'],
  ['medicamento_uso_continuo', 'Uso contínuo de losartana 50mg'],
  ['habito', 'Atividade física 3x/semana; etilismo social'],
  ['antecedente_familiar', 'Mãe com diabetes mellitus tipo 2'],
]
const EXPENSES = [
  { cat: 'aluguel', desc: 'Aluguel da clínica', amount: 850000 },
  { cat: 'servicos', desc: 'Conta de energia elétrica', amount: 120000 },
  { cat: 'materiais', desc: 'Materiais de consumo e descartáveis', amount: 230000 },
  { cat: 'pessoal', desc: 'Folha da recepção', amount: 1800000 },
  { cat: 'outros', desc: 'Marketing: tráfego pago e redes sociais', amount: 150000 },
  { cat: 'servicos', desc: 'Assinatura de sistemas e telefonia', amount: 49900 },
]

async function main() {
  const t = await sb.from('tenants').select('id').eq('slug', TENANT_SLUG).maybeSingle()
  const tenantId = t.data?.id as string
  if (!tenantId) throw new Error(`tenant ${TENANT_SLUG} não encontrado`)
  const users = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
  const ACTOR = users.data?.users.find((u: any) => u.email === ADMIN_EMAIL)?.id as string
  if (!ACTOR) throw new Error(`usuário ${ADMIN_EMAIL} não encontrado`)
  log(`tenant=${tenantId}  actor=${ACTOR}  encKey=${HAS_KEY ? 'sim' : 'NÃO (pacientes serão pulados)'}`)

  // ---- planos
  const planIds: Record<string, string> = {}
  await section('planos', async () => {
    for (const p of PLANS) {
      const ex = await sb.from('health_plans').select('id').eq('tenant_id', tenantId).eq('name', p.name).maybeSingle()
      if (ex.data) { planIds[p.name] = ex.data.id; continue }
      const ins = await sb.from('health_plans').insert({ tenant_id: tenantId, name: p.name, tax_rate_bps: p.tax }).select('id').single()
      if (ins.error) throw new Error(`health_plans: ${ins.error.message}`)
      planIds[p.name] = ins.data.id
    }
    log(`  planos: ${Object.keys(planIds).length}`)
  })

  // ---- procedimentos (tuss real)
  const procIds: string[] = []
  await section('procedimentos', async () => {
    for (const p of PROCS) {
      const cat = await sb.from('tuss_codes').select('code').ilike('description', `%${p.kw}%`).limit(1).maybeSingle()
      const tuss = cat.data?.code
      if (!tuss) { console.error(`   ⚠ sem TUSS p/ "${p.kw}"`); procIds.push(''); continue }
      const ex = await sb.from('procedures').select('id').eq('tenant_id', tenantId).eq('tuss_code', tuss).maybeSingle()
      if (ex.data) { procIds.push(ex.data.id); continue }
      const ins = await sb.from('procedures').insert({
        tenant_id: tenantId, tuss_code: tuss, display_name: p.name,
        covered_by_plan: p.covered, default_amount_cents: p.amount, active: true,
      }).select('id').single()
      if (ins.error) throw new Error(`procedures(${tuss}): ${ins.error.message}`)
      procIds.push(ins.data.id)
    }
    log(`  procedimentos: ${procIds.filter(Boolean).length}`)
  })

  // ---- médicos + comissão
  const doctorIds: string[] = []
  await section('medicos', async () => {
    for (const d of DOCTORS) {
      let id: string
      const ex = await sb.from('doctors').select('id').eq('tenant_id', tenantId).eq('crm', d.crm).maybeSingle()
      if (ex.data) { id = ex.data.id } else {
        const ins = await sb.from('doctors').insert({
          tenant_id: tenantId, full_name: d.full, crm: d.crm, specialty: d.spec,
          role: 'medico', payment_mode: 'comissionado', council_name: 'CRM', council_state: 'SP', active: true,
        }).select('id').single()
        if (ins.error) throw new Error(`doctors: ${ins.error.message}`)
        id = ins.data.id
      }
      doctorIds.push(id)
      const hc = await sb.from('doctor_commission_history').select('id').eq('tenant_id', tenantId).eq('doctor_id', id).limit(1).maybeSingle()
      if (!hc.data) ok('comissao', await sb.from('doctor_commission_history').insert({
        tenant_id: tenantId, doctor_id: id, percentage_bps: d.bps,
        reason: 'Comissão inicial (demo)', valid_from: '2024-01-01', created_by: ACTOR,
      }))
    }
    log(`  medicos: ${doctorIds.length}`)
  })

  // ---- preços
  const priceMatrix: Array<[number, string]> = [
    [0, 'Unimed'], [0, 'Bradesco Saúde'], [0, 'SulAmérica'], [0, 'Amil'], [0, 'Hapvida'], [0, 'Particular'],
    [1, 'Unimed'], [1, 'Particular'], [2, 'Unimed'], [2, 'Bradesco Saúde'],
    [3, 'Particular'], [3, 'SulAmérica'], [4, 'Particular'], [5, 'Particular'],
  ]
  await section('precos', async () => {
    let n = 0
    for (const [pi, planName] of priceMatrix) {
      const procedure_id = procIds[pi]; const plan_id = planIds[planName]
      if (!procedure_id || !plan_id) continue
      const ex = await sb.from('price_versions').select('id').eq('tenant_id', tenantId).eq('procedure_id', procedure_id).eq('plan_id', plan_id).limit(1).maybeSingle()
      if (ex.data) continue
      const base = PROCS[pi].amount
      const amount = planName === 'Particular' ? Math.round(base * 1.3) : base
      const r = await sb.from('price_versions').insert({
        tenant_id: tenantId, procedure_id, plan_id, amount_cents: amount,
        valid_from: '2024-01-01', reason: 'Tabela demo', created_by: ACTOR,
      })
      if (r.error) { console.error(`   ⚠ preco: ${r.error.message}`); } else n++
    }
    log(`  precos novos: ${n}`)
  })

  // ---- pacientes
  let patientIds: string[] = []
  await section('pacientes', async () => {
    if (!HAS_KEY) { log('  pacientes: PULADO (sem chave)'); return }
    const existing = await countOf('patients', tenantId)
    for (let i = existing; i < PATIENTS.length; i++) {
      const p = PATIENTS[i]
      await createPatientManually(sb, {
        tenantId, actorUserId: ACTOR, fullName: p.name, cpf: p.cpf, phone: p.phone,
        email: `${p.name.split(' ')[0].toLowerCase()}@exemplo.com`, birthDate: p.birth,
        sex: p.sex as any, planId: planIds[PLANS[i % PLANS.length].name] ?? null,
      })
    }
    const all = await sb.from('patients').select('id').eq('tenant_id', tenantId).order('created_at', { ascending: true })
    patientIds = (all.data ?? []).map((r: any) => r.id)
    log(`  pacientes: ${patientIds.length}`)
  })

  // re-busca pacientes existentes mesmo sem ter criado agora (re-runs)
  if (patientIds.length === 0) {
    const all = await sb.from('patients').select('id').eq('tenant_id', tenantId).order('created_at', { ascending: true })
    patientIds = (all.data ?? []).map((r: any) => r.id)
  }
  const havePatients = patientIds.length > 0
  const haveDoctors = doctorIds.length > 0 && procIds.some(Boolean)

  // ---- atendimentos
  const apptPlan: Array<{ proc: number; plan: string; day: number }> = [
    { proc: 0, plan: 'Unimed', day: -40 }, { proc: 0, plan: 'Bradesco Saúde', day: -33 },
    { proc: 2, plan: 'Unimed', day: -26 }, { proc: 0, plan: 'Particular', day: -19 },
    { proc: 3, plan: 'Particular', day: -12 }, { proc: 0, plan: 'SulAmérica', day: -6 },
    { proc: 1, plan: 'Unimed', day: -2 }, { proc: 0, plan: 'Amil', day: 1 },
    { proc: 0, plan: 'Hapvida', day: 2 }, { proc: 4, plan: 'Particular', day: 4 },
    { proc: 5, plan: 'Particular', day: 7 }, { proc: 0, plan: 'Particular', day: 10 },
  ]
  await section('atendimentos', async () => {
    if (!havePatients || !haveDoctors) { log('  atendimentos: PULADO (faltam pacientes/médicos)'); return }
    const existing = await countOf('appointments', tenantId)
    if (existing >= apptPlan.length) { log(`  atendimentos já: ${existing}`); return }
    const slot: Record<number, number> = {}
    let created = 0
    for (let i = existing; i < apptPlan.length; i++) {
      const a = apptPlan[i]
      if (!procIds[a.proc]) continue
      const di = i % doctorIds.length
      slot[di] = (slot[di] ?? 0) + 1
      try {
        const res = await createAppointmentManually(sb, {
          tenantId, actorUserId: ACTOR, patientId: patientIds[i % patientIds.length], doctorId: doctorIds[di],
          procedures: [{ procedureId: procIds[a.proc], planId: planIds[a.plan] }],
          appointmentAt: iso(daysFromNow(a.day, 8 + slot[di], 0)), durationMinutes: 30,
          observacoes: 'Atendimento de demonstração', addToTreatmentPlan: true,
        })
        created++
        if (a.day < 0) { try { await markAppointmentRealized(sb, { appointmentId: res.appointmentId, actorUserId: ACTOR }) } catch {} }
      } catch (e) { console.error(`   ⚠ appt ${i}: ${(e as Error).message}`) }
    }
    log(`  atendimentos criados: ${created}`)
  })

  // ---- pagamentos
  await section('pagamentos', async () => {
    if (!havePatients) { log('  pagamentos: PULADO'); return }
    if ((await countOf('payment_records', tenantId)) >= 6) { log('  pagamentos já ok'); return }
    const methods = ['pix', 'cartao_credito', 'dinheiro', 'cartao_debito', 'boleto', 'pix']
    for (let i = 0; i < 6; i++) {
      try {
        await createPaymentRecord(sb, {
          tenantId, actorUserId: ACTOR, patientId: patientIds[i % patientIds.length],
          totalAmountCents: [30000, 40000, 18000, 25000, 12000, 20000][i], paymentMethod: methods[i] as any,
          installmentsCount: i % 2 === 0 ? 1 : 3, initialStatus: i % 2 === 0 ? 'pago' : 'pendente',
          notes: i % 2 === 0 ? 'Pago no atendimento' : 'Parcelado',
        })
      } catch (e) { console.error(`   ⚠ pagamento ${i}: ${(e as Error).message}`) }
    }
    log('  pagamentos: ok')
  })

  // ---- prontuário
  await section('prontuario', async () => {
    if (!havePatients) { log('  prontuário: PULADO'); return }
    const pid = (i: number) => patientIds[i % patientIds.length]
    if ((await countOf('clinical_records', tenantId)) < 6)
      ok('clinical_records', await sb.from('clinical_records').insert(Array.from({ length: 6 }, (_, i) => ({
        tenant_id: tenantId, patient_id: pid(i), created_by: ACTOR, type: 'texto', title: `Evolução clínica ${i + 1}`,
        content: 'S: refere melhora.\nO: exame sem alterações.\nA: estável.\nP: manter conduta, retorno em 30 dias.',
      }))))
    if ((await countOf('vital_signs', tenantId)) < 6)
      ok('vital_signs', await sb.from('vital_signs').insert(Array.from({ length: 6 }, (_, i) => ({
        tenant_id: tenantId, patient_id: pid(i), measured_by: ACTOR, weight_grams: 62000 + i * 4000,
        height_cm: 160 + i * 3, systolic_bp: 118 + i * 3,
        diastolic_bp: 76 + i, heart_rate: 70 + i, temperature_celsius: 36.5, oxygen_saturation: 98,
      }))))
    if ((await countOf('patient_allergies', tenantId)) < 6)
      ok('allergies', await sb.from('patient_allergies').insert(ALLERGIES.map(([substance, severity], i) => ({
        tenant_id: tenantId, patient_id: pid(i), reported_by: ACTOR, substance, severity,
      }))))
    if ((await countOf('patient_diagnoses', tenantId)) < 6)
      ok('diagnoses', await sb.from('patient_diagnoses').insert(CIDS.slice(0, 6).map(([cid10_code, cid10_description], i) => ({
        tenant_id: tenantId, patient_id: pid(i), diagnosed_by: ACTOR, cid10_code, cid10_description, status: 'ativo',
      }))))
    if ((await countOf('patient_history', tenantId)) < 6)
      ok('history', await sb.from('patient_history').insert(HISTORY.map(([category, description], i) => ({
        tenant_id: tenantId, patient_id: pid(i), reported_by: ACTOR, category, description,
      }))))
    log('  prontuário: ok')
  })

  // ---- despesas
  await section('despesas', async () => {
    if ((await countOf('expenses', tenantId)) >= 6) { log('  despesas já ok'); return }
    ok('expenses', await sb.from('expenses').insert(EXPENSES.map((e, i) => ({
      tenant_id: tenantId, created_by: ACTOR, category: e.cat, description: e.desc, amount_cents: e.amount,
      competence_date: daysFromNow(-15 + i).toISOString().slice(0, 10),
      paid_amount_cents: i % 2 === 0 ? e.amount : 0,
      paid_at: i % 2 === 0 ? daysFromNow(-10 + i).toISOString() : null,
      payment_method: i % 2 === 0 ? 'pix' : null,
    }))))
    log('  despesas: ok')
  })

  // ---- tarefas
  await section('tarefas', async () => {
    if ((await countOf('tasks', tenantId)) >= 6) { log('  tarefas já ok'); return }
    const titles: Array<[string, string]> = [
      ['Confirmar agenda da semana', 'alta'], ['Ligar para paciente sobre exame', 'normal'],
      ['Renovar convênio Unimed', 'normal'], ['Comprar material de consumo', 'baixa'],
      ['Revisar repasses do mês', 'urgente'], ['Atualizar tabela de preços', 'baixa'],
    ]
    ok('tasks', await sb.from('tasks').insert(titles.map(([title, priority], i) => ({
      tenant_id: tenantId, assigned_to: ACTOR, assigned_by: ACTOR, created_by: ACTOR, title, priority,
      status: i % 3 === 0 ? 'concluida' : 'pendente', completed_at: i % 3 === 0 ? daysFromNow(-1).toISOString() : null,
      completed_by: i % 3 === 0 ? ACTOR : null, due_date: daysFromNow(2 + i).toISOString().slice(0, 10),
    }))))
    log('  tarefas: ok')
  })

  // ---- lembretes
  await section('lembretes', async () => {
    if ((await countOf('appointment_reminders', tenantId)) >= 5) { log('  lembretes já ok'); return }
    const fut = await sb.from('appointments').select('id').eq('tenant_id', tenantId).gt('appointment_at', new Date().toISOString()).limit(6)
    const rows = (fut.data ?? []).map((a: any, i: number) => ({
      tenant_id: tenantId, appointment_id: a.id, channel: i % 2 === 0 ? 'email' : 'whatsapp',
      scheduled_offset_hours: 24, status: 'queued', is_manual: false,
    }))
    if (rows.length) ok('reminders', await sb.from('appointment_reminders').insert(rows))
    log(`  lembretes: +${rows.length}`)
  })

  // ---- portal + medições
  await section('portal', async () => {
    const taken = await sb.from('tenant_clinic_profile').select('tenant_id').eq('public_booking_slug', PORTAL_SLUG).neq('tenant_id', tenantId).maybeSingle()
    const slug = taken.data ? `${PORTAL_SLUG}-${tenantId.slice(0, 4)}` : PORTAL_SLUG
    ok('profile', await sb.from('tenant_clinic_profile').upsert(
      { tenant_id: tenantId, patient_portal_enabled: true, public_booking_enabled: true, public_booking_slug: slug },
      { onConflict: 'tenant_id' }))
    log(`  portal habilitado em /paciente/${slug}`)
    if (havePatients && (await countOf('patient_measurements', tenantId)) < 15) {
      const metrics: Array<[string, string, number, number]> = [
        ['glicemia_jejum', 'mg/dL', 140, -3], ['hba1c', '%', 8.2, -0.15], ['colesterol_total', 'mg/dL', 220, -4],
      ]
      const rows: any[] = []
      for (let pi = 0; pi < Math.min(3, patientIds.length); pi++)
        for (const [metric_type, unit, start, step] of metrics)
          for (let k = 0; k < 6; k++) rows.push({
            tenant_id: tenantId, patient_id: patientIds[pi], created_by_user_id: ACTOR, metric_type, unit,
            value: Number((start + step * k).toFixed(2)), measured_at: daysFromNow(-150 + k * 25).toISOString().slice(0, 10),
          })
      if (rows.length) ok('measurements', await sb.from('patient_measurements').insert(rows))
      log(`  medições: +${rows.length}`)
    }
  })

  // ---- agendamento público
  await section('agendamento-publico', async () => {
    if (!haveDoctors) { log('  agendamento público: PULADO'); return }
    if ((await countOf('public_booking_doctors', tenantId)) >= 5) { log('  agendamento público já ok'); return }
    ok('public_booking', await sb.from('public_booking_doctors').insert(doctorIds.slice(0, 6).map((doctor_id, i) => ({
      tenant_id: tenantId, doctor_id, display_order: i, bio: `${DOCTORS[i].spec} — atendimento humanizado.`,
      available_weekdays: [1, 2, 3, 4, 5], available_from: '08:00', available_until: '18:00',
    }))))
    log('  agendamento público: ok')
  })

  // ---- prescrições Memed (best-effort)
  await section('prescricoes', async () => {
    if (!havePatients || !haveDoctors) { log('  prescrições: PULADO'); return }
    if ((await countOf('prescription_records', tenantId)) >= 5) { log('  prescrições já ok'); return }
    const r = await sb.from('prescription_records').insert(Array.from({ length: 5 }, (_, i) => ({
      tenant_id: tenantId, patient_id: patientIds[i % patientIds.length], doctor_id: doctorIds[i % doctorIds.length],
      created_by_user_id: ACTOR, memed_prescription_id: `demo-rx-${1000 + i}`, status: 'issued',
      issued_at: daysFromNow(-20 + i * 3).toISOString(),
    })))
    log(r.error ? `  prescrições: pulado (${r.error.message.slice(0, 60)})` : '  prescrições: +5')
  })

  // ---- notificações
  await section('notificacoes', async () => {
    const r = await sb.rpc('generate_user_notifications', { p_tenant_id: tenantId, p_user_id: ACTOR })
    log(r.error ? `  notificações: pulado (${r.error.message.slice(0, 60)})` : '  notificações: geradas')
  })

  log('\n✅ seed concluído.')
  log(`   portal demo: paciente ex. CPF ${PATIENTS[0].cpf} / nasc. ${PATIENTS[0].birth.split('-').reverse().join('/')}`)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
