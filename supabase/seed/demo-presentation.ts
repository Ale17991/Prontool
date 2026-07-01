#!/usr/bin/env tsx
/**
 * Seed de APRESENTAÇÃO — enriquece a clínica demo (`clinica-demo`) com dados
 * que contam a história do Clinnipro nas 3 telas-chave:
 *
 *   1. Prontuário/Agenda — pacientes reais + agendamentos (passados e da semana)
 *   2. Odonto-Space — odontograma preenchido, plano/orçamento e periograma
 *      (com 2 exames para comparação)
 *   3. Financeiro — mês anterior FECHADO com repasse por profissional
 *
 * Pré-requisito: rodar `pnpm seed:demo` antes (cria tenant, usuários, médicos,
 * procedimentos, planos, preços e comissões). Idempotente por marcador
 * (ghl_contact_id = 'demo-pres-01'); reexecutar não duplica.
 *
 * Uso: pnpm seed:demo-pres   (ou: npx tsx --env-file=.env.local supabase/seed/demo-presentation.ts)
 */
import { randomUUID } from 'node:crypto'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createPaymentRecord } from '@/lib/core/payments/create'

const BRT = '-03:00'

function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function iso(year: number, month1: number, day: number, hour = 14): string {
  return `${year}-${String(month1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00${BRT}`
}

const PATIENTS = [
  { tag: 'demo-pres-01', name: 'Marina Alves Pereira', cpf: '31244567890', birth: '1988-03-12', phone: '11987650001' },
  { tag: 'demo-pres-02', name: 'Carlos Henrique Souza', cpf: '40855612377', birth: '1975-09-30', phone: '11987650002' },
  { tag: 'demo-pres-03', name: 'Júlia Fernandes Lima', cpf: '22933144501', birth: '1995-06-22', phone: '11987650003' },
  { tag: 'demo-pres-04', name: 'Roberto Dias Martins', cpf: '55712398804', birth: '1969-11-05', phone: '11987650004' },
  { tag: 'demo-pres-05', name: 'Beatriz Gomes Rocha', cpf: '10288345566', birth: '2001-02-17', phone: '11987650005' },
  { tag: 'demo-pres-06', name: 'Pedro Henrique Castro', cpf: '67144928810', birth: '1983-07-08', phone: '11987650006' },
]

async function main() {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY é obrigatória (use --env-file=.env.local)')
  const sb = createSupabaseServiceClient()
  const enc = async (plain: string): Promise<string> => {
    const { data, error } = await sb.rpc('enc_text_with_key', { plain, key })
    if (error || data == null) throw new Error(`enc_text_with_key falhou: ${error?.message}`)
    return data as unknown as string
  }

  // --- tenant + admin ---------------------------------------------------
  // Alvo configurável por slug (DEMO_TENANT_SLUG); default = clínica demo local.
  const slug = process.env.DEMO_TENANT_SLUG ?? 'clinica-demo'
  const tenant = await sb.from('tenants').select('id, name').eq('slug', slug).maybeSingle()
  if (!tenant.data) throw new Error(`Tenant slug='${slug}' não encontrado.`)
  const tenantId = tenant.data.id
  const adminLink = await sb
    .from('user_tenants')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  if (!adminLink.data) throw new Error(`Nenhum admin no tenant '${slug}'.`)
  const adminId = adminLink.data.user_id
  console.info(`[demo-pres] alvo: ${tenant.data.name} (slug=${slug})`)

  // --- perfil da clínica (nome/fuso p/ cabeçalhos e fechamento) --------
  await sb
    .from('tenant_clinic_profile')
    .upsert({ tenant_id: tenantId, corporate_name: 'Clínica Demo Clinnipro', timezone: 'America/Sao_Paulo' }, { onConflict: 'tenant_id' })
    .throwOnError()

  // --- médicos + comissões ---------------------------------------------
  const docsRes = await sb
    .from('doctors')
    .select('id, full_name')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
  const doctors = docsRes.data ?? []
  if (doctors.length < 2) throw new Error('Esperado >=2 médicos do seed:demo.')
  const commByDoctor = new Map<string, { id: string; bps: number }>()
  for (const d of doctors) {
    const c = await sb
      .from('doctor_commission_history')
      .select('id, percentage_bps')
      .eq('tenant_id', tenantId)
      .eq('doctor_id', d.id)
      .order('valid_from', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (c.data) commByDoctor.set(d.id, { id: c.data.id, bps: c.data.percentage_bps })
  }

  // --- preços (carregam procedure_id, plan_id, amount) -----------------
  const pvRes = await sb
    .from('price_versions')
    .select('id, procedure_id, plan_id, amount_cents')
    .eq('tenant_id', tenantId)
    .order('valid_from', { ascending: false })
  const priceVersions = pvRes.data ?? []
  if (priceVersions.length === 0) throw new Error('Sem price_versions; rode `pnpm seed:demo`.')
  const plansRes = await sb.from('health_plans').select('id, name').eq('tenant_id', tenantId)
  const particularId = (plansRes.data ?? []).find((p) => p.name === 'Particular')?.id ?? null

  // --- idempotência -----------------------------------------------------
  const marker = await sb
    .from('patients')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('ghl_contact_id', 'demo-pres-01')
    .maybeSingle()

  const patientIds: Record<string, string> = {}
  if (marker.data) {
    console.info('[demo-pres] pacientes de apresentação já existem; reusando.')
    const existing = await sb
      .from('patients')
      .select('id, ghl_contact_id')
      .eq('tenant_id', tenantId)
      .like('ghl_contact_id', 'demo-pres-%')
    for (const p of existing.data ?? []) patientIds[p.ghl_contact_id as string] = p.id
  } else {
    for (const p of PATIENTS) {
      const id = randomUUID()
      await sb
        .from('patients')
        .insert({
          id,
          tenant_id: tenantId,
          ghl_contact_id: p.tag,
          full_name_enc: await enc(p.name),
          cpf_enc: await enc(p.cpf),
          birth_date_enc: await enc(p.birth),
          phone_enc: await enc(p.phone),
        })
        .throwOnError()
      patientIds[p.tag] = id
      console.info(`[demo-pres] paciente ${p.name}`)
    }
  }

  const pid = (tag: string): string => {
    const id = patientIds[tag]
    if (!id) throw new Error(`paciente ${tag} ausente`)
    return id
  }

  // ====================================================================
  // AGENDAMENTOS — mês anterior (realizados, p/ repasse) + semana atual
  // ====================================================================
  const now = new Date()
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevMonth = ym(prev)
  const pyear = prev.getFullYear()
  const pmonth = prev.getMonth() + 1

  async function createAppointment(args: {
    patientTag: string
    doctorId: string
    pv: { id: string; procedure_id: string; plan_id: string; amount_cents: number }
    at: string
    completed: boolean
  }): Promise<string> {
    const comm = commByDoctor.get(args.doctorId)
    if (!comm) throw new Error('médico sem comissão')
    const id = randomUUID()
    await sb
      .from('appointments')
      .insert({
        id,
        tenant_id: tenantId,
        patient_id: pid(args.patientTag),
        doctor_id: args.doctorId,
        procedure_id: args.pv.procedure_id,
        plan_id: args.pv.plan_id,
        frozen_amount_cents: args.pv.amount_cents,
        frozen_commission_bps: comm.bps,
        source_price_version_id: args.pv.id,
        source_commission_history_id: comm.id,
        appointment_at: args.at,
      })
      .throwOnError()
    if (args.completed) {
      await sb
        .from('appointment_completions')
        .insert({ tenant_id: tenantId, appointment_id: id, completed_by: adminId, source: 'manual' })
        .throwOnError()
    }
    return id
  }

  // Helpers p/ pegar um pv particular e um de convênio.
  const pvParticular = priceVersions.find((p) => p.plan_id === particularId) ?? priceVersions[0]!
  const pvConvenio = priceVersions.find((p) => p.plan_id !== particularId) ?? priceVersions[0]!

  if (!marker.data) {
    const dA = doctors[0]!.id
    const dB = doctors[1]!.id

    // ---- mês anterior: realizados (entram no repasse fechado) ----
    const past: Array<{ tag: string; doc: string; pv: typeof priceVersions[number]; day: number }> = [
      { tag: 'demo-pres-01', doc: dA, pv: pvParticular, day: 6 },
      { tag: 'demo-pres-02', doc: dA, pv: pvConvenio, day: 8 },
      { tag: 'demo-pres-03', doc: dB, pv: pvParticular, day: 9 },
      { tag: 'demo-pres-04', doc: dB, pv: pvConvenio, day: 13 },
      { tag: 'demo-pres-05', doc: dA, pv: pvParticular, day: 15 },
      { tag: 'demo-pres-06', doc: dB, pv: pvParticular, day: 16 },
      { tag: 'demo-pres-01', doc: dB, pv: pvConvenio, day: 20 },
      { tag: 'demo-pres-02', doc: dA, pv: pvParticular, day: 22 },
      { tag: 'demo-pres-03', doc: dA, pv: pvConvenio, day: 23 },
      { tag: 'demo-pres-04', doc: dB, pv: pvParticular, day: 27 },
    ]
    const pastApptByTag: Record<string, string> = {}
    for (const a of past) {
      const apptId = await createAppointment({
        patientTag: a.tag,
        doctorId: a.doc,
        pv: a.pv,
        at: iso(pyear, pmonth, a.day, 9 + (a.day % 8)),
        completed: true,
      })
      if (!pastApptByTag[a.tag]) pastApptByTag[a.tag] = apptId
    }

    // ---- pagamentos (particular) — alguns pagos, mostra financeiro ----
    const pays: Array<{ tag: string; method: 'pix' | 'dinheiro' | 'cartao_credito'; cents: number }> = [
      { tag: 'demo-pres-01', method: 'pix', cents: pvParticular.amount_cents },
      { tag: 'demo-pres-05', method: 'cartao_credito', cents: pvParticular.amount_cents },
      { tag: 'demo-pres-02', method: 'dinheiro', cents: pvParticular.amount_cents },
    ]
    for (const p of pays) {
      try {
        await createPaymentRecord(sb, {
          tenantId,
          patientId: pid(p.tag),
          appointmentId: pastApptByTag[p.tag] ?? null,
          totalAmountCents: p.cents,
          paymentMethod: p.method,
          initialStatus: 'pago',
          paidAt: iso(pyear, pmonth, 25, 12),
          actorUserId: adminId,
        })
      } catch (e) {
        console.warn(`[demo-pres] pagamento ${p.tag} falhou (seguindo):`, (e as Error).message)
      }
    }

    // ---- semana atual: agendados (agenda) ----
    const wkBase = now.getDate()
    const week: Array<{ tag: string; doc: string; pv: typeof priceVersions[number]; offset: number; hour: number }> = [
      { tag: 'demo-pres-03', doc: dA, pv: pvConvenio, offset: 0, hour: 9 },
      { tag: 'demo-pres-06', doc: dB, pv: pvParticular, offset: 0, hour: 11 },
      { tag: 'demo-pres-01', doc: dA, pv: pvParticular, offset: 1, hour: 10 },
      { tag: 'demo-pres-04', doc: dB, pv: pvConvenio, offset: 1, hour: 14 },
      { tag: 'demo-pres-02', doc: dA, pv: pvParticular, offset: 2, hour: 15 },
      { tag: 'demo-pres-05', doc: dB, pv: pvParticular, offset: 3, hour: 9 },
    ]
    for (const w of week) {
      const d = new Date(now.getFullYear(), now.getMonth(), wkBase + w.offset)
      await createAppointment({
        patientTag: w.tag,
        doctorId: w.doc,
        pv: w.pv,
        at: iso(d.getFullYear(), d.getMonth() + 1, d.getDate(), w.hour),
        completed: false,
      })
    }
    console.info('[demo-pres] agendamentos (mês anterior + semana) criados.')
  }

  // ====================================================================
  // ODONTO — odontograma (chart entries)
  // ====================================================================
  const statusRes = await sb.from('dental_status_catalog').select('id, code, scope')
  const statusByCode = new Map<string, { id: string; scope: string }>()
  for (const s of statusRes.data ?? []) statusByCode.set(s.code, { id: s.id, scope: s.scope })
  const stat = (code: string) => {
    const s = statusByCode.get(code)
    if (!s) throw new Error(`status odonto '${code}' ausente (migration 0134)`)
    return s
  }

  async function chartEntry(tag: string, toothFdi: number, code: string, surface: string | null, note?: string) {
    const s = stat(code)
    await sb
      .from('dental_chart_entries')
      .insert({
        tenant_id: tenantId,
        patient_id: pid(tag),
        tooth_fdi: toothFdi,
        surface: s.scope === 'tooth' ? null : surface,
        status_id: s.id,
        note: note ?? null,
        created_by: adminId,
      })
      .throwOnError()
  }

  if (!marker.data) {
    // Paciente 1 — caso rico
    await chartEntry('demo-pres-01', 16, 'caries', 'occlusal_incisal', 'Cárie oclusal')
    await chartEntry('demo-pres-01', 26, 'restoration', 'mesial')
    await chartEntry('demo-pres-01', 11, 'crown', null, 'Coroa cerâmica')
    await chartEntry('demo-pres-01', 36, 'root_canal', null)
    await chartEntry('demo-pres-01', 46, 'caries', 'distal')
    await chartEntry('demo-pres-01', 21, 'restoration', 'vestibular')
    // Paciente 2
    await chartEntry('demo-pres-02', 14, 'missing', null)
    await chartEntry('demo-pres-02', 15, 'implant', null)
    await chartEntry('demo-pres-02', 24, 'restoration', 'occlusal_incisal')
    await chartEntry('demo-pres-02', 17, 'caries', 'mesial')
    console.info('[demo-pres] odontograma preenchido (pac. 1 e 2).')

    // ---- Plano de tratamento + orçamento (paciente 1) ----
    const proc0 = priceVersions[0]!.procedure_id
    const procA = (priceVersions.find((p) => p.procedure_id !== proc0)?.procedure_id) ?? proc0
    const budgetId = randomUUID()
    await sb
      .from('treatment_budgets')
      .insert({ id: budgetId, tenant_id: tenantId, patient_id: pid('demo-pres-01'), title: 'Plano restaurador', status: 'proposto', created_by: adminId })
      .throwOnError()
    const steps = [
      { proc: proc0, tooth: 16, surface: 'occlusal_incisal', title: 'Restauração dente 16' },
      { proc: procA, tooth: 36, surface: null, title: 'Tratamento de canal dente 36' },
    ]
    for (const s of steps) {
      await sb
        .from('treatment_plan_steps')
        .insert({
          tenant_id: tenantId,
          patient_id: pid('demo-pres-01'),
          procedure_id: s.proc,
          doctor_id: doctors[0]!.id,
          title: s.title,
          status: 'pendente',
          tooth_fdi: s.tooth,
          surface: s.surface,
          budget_id: budgetId,
          created_by: adminId,
        } as never)
        .throwOnError()
    }
    await sb
      .from('treatment_budgets')
      .update({ status: 'apresentado', presented_at: new Date().toISOString() })
      .eq('id', budgetId)
      .throwOnError()
    console.info('[demo-pres] plano de tratamento + orçamento (pac. 1).')
  }

  // ====================================================================
  // PERIOGRAMA — exames finalizados (pac.1 com 2 p/ comparação; pac.2 com 1)
  // ====================================================================
  const PERIO_TEETH = [16, 11, 21, 26, 36, 31, 41, 46]
  const PERIO_SITES = ['db', 'b', 'mb', 'dl', 'l', 'ml'] as const

  async function perioExam(tag: string, examDate: string, severity: 'pior' | 'melhor') {
    const examId = randomUUID()
    await sb
      .from('perio_exams')
      .insert({ id: examId, tenant_id: tenantId, patient_id: pid(tag), exam_date: examDate, status: 'rascunho', dentition: 'permanent', created_by: adminId })
      .throwOnError()
    const rows: Array<Record<string, unknown>> = []
    PERIO_TEETH.forEach((tooth, ti) => {
      PERIO_SITES.forEach((site, si) => {
        const base = severity === 'pior' ? 4 : 2
        const pd = base + ((ti + si) % 3) // pior: 4-6, melhor: 2-4
        rows.push({
          tenant_id: tenantId,
          exam_id: examId,
          tooth_fdi: tooth,
          site,
          probing_depth_mm: pd,
          recession_mm: (ti + si) % 2,
          bleeding: pd >= 4,
        })
      })
    })
    await sb.from('perio_site_measurements').insert(rows as never).throwOnError()
    await sb
      .from('perio_tooth_findings')
      .insert([
        { tenant_id: tenantId, exam_id: examId, tooth_fdi: 16, mobility: severity === 'pior' ? 1 : 0, furcation: severity === 'pior' ? 1 : null },
        { tenant_id: tenantId, exam_id: examId, tooth_fdi: 36, mobility: 1 },
      ] as never)
      .throwOnError()
    await sb
      .from('perio_exams')
      .update({ status: 'finalizado', finalized_at: new Date().toISOString(), finalized_by: adminId })
      .eq('id', examId)
      .throwOnError()
  }

  if (!marker.data) {
    await perioExam('demo-pres-01', `${pyear}-${String(pmonth).padStart(2, '0')}-10`, 'pior')
    await perioExam('demo-pres-01', iso(now.getFullYear(), now.getMonth() + 1, Math.max(1, now.getDate() - 2)).slice(0, 10), 'melhor')
    await perioExam('demo-pres-02', `${pyear}-${String(pmonth).padStart(2, '0')}-18`, 'pior')
    console.info('[demo-pres] periograma: 3 exames finalizados (pac.1 com 2 p/ comparação).')
  }

  // ====================================================================
  // FINANCEIRO — fechar o mês anterior (repasse por profissional)
  // ====================================================================
  const close = await sb.rpc('close_monthly_payout', { p_tenant_id: tenantId, p_month: prevMonth })
  if (close.error) {
    if (/already_closed/.test(close.error.message)) {
      console.info(`[demo-pres] mês ${prevMonth} já estava fechado.`)
    } else {
      console.warn(`[demo-pres] fechamento do mês ${prevMonth} falhou:`, close.error.message)
    }
  } else {
    console.info(`[demo-pres] mês ${prevMonth} FECHADO:`, close.data)
  }

  console.info('\n[demo-pres] CONCLUÍDO.')
  console.info(`  tenant: ${tenant.data.name} (slug=${slug})`)
  console.info(`  mês fechado p/ repasse: ${prevMonth}`)
  console.info(`  pacientes de apresentação: ${PATIENTS.length} (odonto preenchido em 2; periograma em 2)`)
}

main().catch((err: unknown) => {
  console.error('[demo-pres] FALHOU:', err)
  process.exit(1)
})
