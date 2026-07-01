// @ts-nocheck
/**
 * Exporta para .xlsx os atendimentos da Padilha que ficaram SEM pagamento
 * associado (bug do 403 da recepção): valor > 0, não cancelados/estornados, e
 * sem nenhuma linha em payment_records. Read-only — só gera o arquivo.
 *
 * Rodar: pnpm tsx --env-file=.env.production.local scripts/export-padilha-sem-pagamento.ts
 */
import ExcelJS from 'exceljs'
import path from 'node:path'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'

const TENANT_QUERY = process.argv[2] ?? 'padilha'
const sb: any = createSupabaseServiceClient()

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

async function main() {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY ausente')

  const t = await sb
    .from('tenants')
    .select('id, name')
    .ilike('name', `%${TENANT_QUERY}%`)
    .maybeSingle()
  if (!t.data) throw new Error(`tenant ~"${TENANT_QUERY}" não encontrado`)
  const tenantId = t.data.id
  console.log(`tenant: ${t.data.name} (${tenantId})`)

  // 1) Atendimentos ativos com valor > 0.
  const apptRes = await sb
    .from('appointments_effective')
    .select(
      'id, appointment_at, patient_id, doctor_id, procedure_id, frozen_amount_cents, effective_status',
    )
    .eq('tenant_id', tenantId)
    .gt('frozen_amount_cents', 0)
    .order('appointment_at', { ascending: true })
    .limit(5000)
  if (apptRes.error) throw new Error(`appointments: ${apptRes.error.message}`)
  const appts = (apptRes.data ?? []).filter(
    (a: any) => a.id && a.effective_status !== 'cancelado' && a.effective_status !== 'estornado',
  )
  console.log(`atendimentos ativos com valor: ${appts.length}`)

  // 2) Quais já têm pagamento.
  const ids = appts.map((a: any) => a.id)
  const paid = new Set<string>()
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const payRes = await sb
      .from('payment_records')
      .select('appointment_id')
      .eq('tenant_id', tenantId)
      .in('appointment_id', chunk)
    for (const p of payRes.data ?? []) if (p.appointment_id) paid.add(p.appointment_id)
  }
  const missing = appts.filter((a: any) => !paid.has(a.id))
  console.log(`SEM pagamento: ${missing.length}`)

  // 3) Nomes (paciente decifrado, médico, procedimento).
  const patientIds = [...new Set(missing.map((a: any) => a.patient_id).filter(Boolean))]
  const nameByPatient = new Map<string, string>()
  for (let i = 0; i < patientIds.length; i += 200) {
    const chunk = patientIds.slice(i, i + 200)
    const dec = await sb.rpc('decrypt_patient_names_for_ids', {
      p_tenant_id: tenantId,
      p_patient_ids: chunk,
      p_key: key,
    })
    for (const r of dec.data ?? [])
      nameByPatient.set(r.id, r.anonymized_at ? '[anonimizado]' : (r.full_name ?? '—'))
  }
  const doctorIds = [...new Set(missing.map((a: any) => a.doctor_id).filter(Boolean))]
  const docRes = await sb
    .from('doctors')
    .select('id, full_name')
    .eq('tenant_id', tenantId)
    .in('id', doctorIds)
  const nameByDoctor = new Map((docRes.data ?? []).map((d: any) => [d.id, d.full_name]))
  const procIds = [...new Set(missing.map((a: any) => a.procedure_id).filter(Boolean))]
  const procRes = await sb
    .from('procedures')
    .select('id, display_name')
    .eq('tenant_id', tenantId)
    .in('id', procIds)
  const nameByProc = new Map((procRes.data ?? []).map((p: any) => [p.id, p.display_name]))

  // 4) Planilha.
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sem pagamento')
  ws.columns = [
    { header: 'Data/Hora', key: 'when', width: 18 },
    { header: 'Paciente', key: 'patient', width: 32 },
    { header: 'Profissional', key: 'doctor', width: 28 },
    { header: 'Procedimento', key: 'procedure', width: 30 },
    { header: 'Valor (R$)', key: 'value', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Atendimento ID', key: 'id', width: 38 },
  ]
  ws.getRow(1).font = { bold: true }
  for (const a of missing) {
    ws.addRow({
      when: fmtWhen(a.appointment_at),
      patient: nameByPatient.get(a.patient_id) ?? '—',
      doctor: nameByDoctor.get(a.doctor_id) ?? '—',
      procedure: nameByProc.get(a.procedure_id) ?? '—',
      value: Number((a.frozen_amount_cents / 100).toFixed(2)),
      status: a.effective_status ?? '—',
      id: a.id,
    })
  }
  ws.getColumn('value').numFmt = '#,##0.00'

  const out = path.join(process.cwd(), 'docs', 'padilha-atendimentos-sem-pagamento.xlsx')
  await wb.xlsx.writeFile(out)
  console.log(`\n✅ ${missing.length} linha(s) -> ${out}`)
}

main().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
