/* eslint-disable react/no-unknown-property */
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import type { ProntuarioBundle } from './assemble-prontuario'

const styles = StyleSheet.create({
  page: {
    padding: 32,
    paddingBottom: 64, // espaço pro footer fixo
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#0f172a',
  },
  header: {
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  clinicName: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  subtle: { color: '#64748b', fontSize: 8 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    marginTop: 12,
    marginBottom: 4,
    color: '#1e293b',
    paddingBottom: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: '#cbd5e1',
  },
  twoCol: { flexDirection: 'row', gap: 12 },
  col: { flex: 1 },
  label: {
    fontSize: 7,
    color: '#64748b',
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  value: { fontSize: 9, marginBottom: 4 },
  pill: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    fontSize: 8,
    marginRight: 4,
    marginBottom: 2,
  },
  pillRose: { backgroundColor: '#fee2e2', color: '#991b1b' },
  pillOrange: { backgroundColor: '#ffedd5', color: '#9a3412' },
  pillYellow: { backgroundColor: '#fef9c3', color: '#854d0e' },
  pillEmerald: { backgroundColor: '#d1fae5', color: '#065f46' },
  pillBlue: { backgroundColor: '#dbeafe', color: '#1e40af' },
  pillSlate: { backgroundColor: '#f1f5f9', color: '#334155' },
  table: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 3,
    marginBottom: 4,
  },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    minHeight: 16,
    alignItems: 'center',
  },
  trHeader: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
    minHeight: 18,
  },
  th: {
    paddingHorizontal: 4,
    paddingVertical: 3,
    fontFamily: 'Helvetica-Bold',
    fontSize: 7,
    color: '#334155',
  },
  td: {
    paddingHorizontal: 4,
    paddingVertical: 3,
    fontSize: 7,
  },
  empty: { color: '#94a3b8', fontSize: 8, fontStyle: 'italic', paddingVertical: 4 },
  block: {
    marginBottom: 6,
    padding: 6,
    backgroundColor: '#f8fafc',
    borderRadius: 3,
  },
  blockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  soapLetter: {
    width: 12,
    height: 12,
    backgroundColor: '#2563eb',
    color: 'white',
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    paddingTop: 2,
    borderRadius: 2,
    marginRight: 4,
  },
  soapRow: { flexDirection: 'row', marginTop: 3 },
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 32,
    right: 32,
    fontSize: 7,
    color: '#64748b',
    borderTopWidth: 0.5,
    borderTopColor: '#cbd5e1',
    paddingTop: 6,
  },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  signatureLine: {
    marginTop: 14,
    borderTopWidth: 0.5,
    borderTopColor: '#0f172a',
    paddingTop: 2,
    width: 220,
  },
})

function pillForSeverity(severity: string) {
  if (severity === 'grave') return styles.pillRose
  if (severity === 'moderada') return styles.pillOrange
  return styles.pillYellow
}

function pillForBmi(bmi: number | null) {
  if (bmi === null) return styles.pillSlate
  if (bmi < 18.5) return styles.pillBlue
  if (bmi < 25) return styles.pillEmerald
  if (bmi < 30) return styles.pillYellow
  return styles.pillRose
}

const HISTORY_LABEL: Record<string, string> = {
  doenca_pregressa: 'Doenças pregressas',
  cirurgia: 'Cirurgias',
  medicamento_uso_continuo: 'Medicamentos contínuos',
  antecedente_familiar: 'Antecedentes familiares',
  habito: 'Hábitos',
  outro: 'Outros',
}

const SEVERITY_LABEL: Record<string, string> = {
  leve: 'Leve',
  moderada: 'Moderada',
  grave: 'Grave',
}

function formatBRL(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value.length === 10 ? `${value}T12:00:00Z` : value)
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

function formatStatus(status: 'ativo' | 'em_acompanhamento' | 'resolvido'): string {
  switch (status) {
    case 'ativo':
      return 'Ativo'
    case 'em_acompanhamento':
      return 'Em acompanhamento'
    case 'resolvido':
      return 'Resolvido'
  }
}

function ageFrom(birth: string | null): string {
  if (!birth) return '—'
  const d = new Date(birth)
  if (Number.isNaN(d.getTime())) return '—'
  const today = new Date()
  let years = today.getFullYear() - d.getFullYear()
  const m = today.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) years--
  return `${years} anos`
}

function formatAddress(a: ProntuarioBundle['patient']['address']): string {
  if (!a) return '—'
  const line1 = [a.street, a.number].filter(Boolean).join(', ')
  const compl = a.complement ? ` — ${a.complement}` : ''
  const line2 = [a.neighborhood, a.city, a.state].filter(Boolean).join(' / ')
  const cep = a.cep ? `CEP ${formatCepText(a.cep)}` : null
  const out = [line1 + compl, line2, cep].filter(Boolean).join(' · ')
  return out || '—'
}

function formatCepText(raw: string): string {
  const d = raw.replace(/\D/g, '')
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : raw
}

export function ProntuarioDocument({ bundle }: { bundle: ProntuarioBundle }) {
  const { patient } = bundle
  const generated = formatDateTime(bundle.generatedAt)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* ============== Header ============== */}
        <View style={styles.header} fixed>
          <Text style={styles.clinicName}>{bundle.tenantName}</Text>
          <Text style={styles.subtle}>
            Prontuário eletrônico ·{' '}
            {bundle.period.from || bundle.period.to
              ? `Período ${formatDate(bundle.period.from)} – ${formatDate(bundle.period.to)}`
              : 'Histórico completo'}
          </Text>
        </View>

        {/* ============== 1. Dados do paciente ============== */}
        <Text style={styles.sectionTitle}>1. Dados do Paciente</Text>
        <View style={styles.twoCol}>
          <View style={styles.col}>
            <Text style={styles.label}>Nome</Text>
            <Text style={styles.value}>{patient.fullName || '—'}</Text>
            <Text style={styles.label}>CPF</Text>
            <Text style={styles.value}>{patient.cpf || '—'}</Text>
            <Text style={styles.label}>Data de nascimento</Text>
            <Text style={styles.value}>
              {formatDate(patient.birthDate)} · {ageFrom(patient.birthDate)}
            </Text>
            <Text style={styles.label}>Plano de saúde</Text>
            <Text style={styles.value}>{patient.healthPlan?.name ?? 'Particular'}</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Telefone</Text>
            <Text style={styles.value}>{patient.phone || '—'}</Text>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{patient.email || '—'}</Text>
            <Text style={styles.label}>Endereço</Text>
            <Text style={styles.value}>{formatAddress(patient.address)}</Text>
          </View>
        </View>

        {/* ============== 2. Alergias ============== */}
        <Text style={styles.sectionTitle}>2. Alergias</Text>
        {bundle.allergies.length === 0 ? (
          <Text style={styles.empty}>Sem alergias conhecidas.</Text>
        ) : (
          <View>
            {bundle.allergies.map((a) => (
              <View key={a.id} style={styles.soapRow}>
                <Text style={[styles.pill, pillForSeverity(a.severity)]}>
                  {SEVERITY_LABEL[a.severity] ?? a.severity}
                </Text>
                <Text style={{ flex: 1, fontSize: 9 }}>
                  <Text style={{ fontFamily: 'Helvetica-Bold' }}>{a.substance}</Text>
                  {a.notes ? ` — ${a.notes}` : ''}
                  <Text style={styles.subtle}> · {formatDate(a.reportedAt)}</Text>
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* ============== 3. Antecedentes ============== */}
        <Text style={styles.sectionTitle}>3. Antecedentes</Text>
        {bundle.history.length === 0 ? (
          <Text style={styles.empty}>Nenhum antecedente registrado.</Text>
        ) : (
          (() => {
            const grouped = new Map<string, typeof bundle.history>()
            for (const h of bundle.history) {
              const list = grouped.get(h.category) ?? []
              list.push(h)
              grouped.set(h.category, list)
            }
            return Array.from(grouped.entries()).map(([cat, items]) => (
              <View key={cat} style={{ marginBottom: 4 }}>
                <Text style={[styles.label, { marginTop: 3 }]}>
                  {HISTORY_LABEL[cat] ?? cat}
                </Text>
                {items.map((h) => (
                  <Text key={h.id} style={styles.value}>
                    • {h.description}
                    {h.dateReported ? ` (${formatDate(h.dateReported)})` : ''}
                    {h.notes ? ` — ${h.notes}` : ''}
                  </Text>
                ))}
              </View>
            ))
          })()
        )}

        {/* ============== 4. Sinais vitais ============== */}
        <Text style={styles.sectionTitle}>4. Sinais Vitais</Text>
        {bundle.vitalSigns.length === 0 ? (
          <Text style={styles.empty}>Sem registros de sinais vitais.</Text>
        ) : (
          <>
            {(() => {
              const last = bundle.vitalSigns[0]
              if (!last) return null
              return (
                <View style={styles.block}>
                  <Text style={styles.label}>
                    Último registro · {formatDateTime(last.measuredAt)}
                  </Text>
                  <Text style={styles.value}>
                    PA{' '}
                    {last.systolicBp && last.diastolicBp
                      ? `${last.systolicBp}/${last.diastolicBp} mmHg`
                      : '—'}
                    {' · FC '}
                    {last.heartRate ? `${last.heartRate} bpm` : '—'}
                    {' · FR '}
                    {last.respiratoryRate ? `${last.respiratoryRate} irpm` : '—'}
                    {' · Temp '}
                    {last.temperatureCelsius !== null
                      ? `${last.temperatureCelsius.toFixed(1)} °C`
                      : '—'}
                    {' · SpO₂ '}
                    {last.oxygenSaturation ? `${last.oxygenSaturation}%` : '—'}
                  </Text>
                  <Text style={styles.value}>
                    Peso{' '}
                    {last.weightGrams !== null
                      ? `${(last.weightGrams / 1000).toFixed(1)} kg`
                      : '—'}
                    {' · Altura '}
                    {last.heightCm ? `${last.heightCm} cm` : '—'}
                    {' · IMC '}
                    {last.bmi !== null ? last.bmi.toFixed(1) : '—'}{' '}
                    {last.bmi !== null ? (
                      <Text style={[styles.pill, pillForBmi(last.bmi)]}>
                        {last.bmi < 18.5
                          ? 'Abaixo'
                          : last.bmi < 25
                            ? 'Normal'
                            : last.bmi < 30
                              ? 'Sobrepeso'
                              : 'Obeso'}
                      </Text>
                    ) : null}
                  </Text>
                </View>
              )
            })()}
            {bundle.vitalSigns.length > 1 ? (
              <View style={styles.table}>
                <View style={styles.trHeader}>
                  <Text style={[styles.th, { flex: 1.5 }]}>Data</Text>
                  <Text style={[styles.th, { flex: 1 }]}>PA</Text>
                  <Text style={[styles.th, { flex: 0.7 }]}>FC</Text>
                  <Text style={[styles.th, { flex: 0.7 }]}>Temp</Text>
                  <Text style={[styles.th, { flex: 0.7 }]}>SpO₂</Text>
                  <Text style={[styles.th, { flex: 0.8 }]}>Peso</Text>
                  <Text style={[styles.th, { flex: 0.6 }]}>IMC</Text>
                </View>
                {bundle.vitalSigns.slice(0, 5).map((v) => (
                  <View key={v.id} style={styles.tr}>
                    <Text style={[styles.td, { flex: 1.5 }]}>
                      {formatDateTime(v.measuredAt)}
                    </Text>
                    <Text style={[styles.td, { flex: 1 }]}>
                      {v.systolicBp && v.diastolicBp
                        ? `${v.systolicBp}/${v.diastolicBp}`
                        : '—'}
                    </Text>
                    <Text style={[styles.td, { flex: 0.7 }]}>{v.heartRate ?? '—'}</Text>
                    <Text style={[styles.td, { flex: 0.7 }]}>
                      {v.temperatureCelsius?.toFixed(1) ?? '—'}
                    </Text>
                    <Text style={[styles.td, { flex: 0.7 }]}>
                      {v.oxygenSaturation ?? '—'}
                    </Text>
                    <Text style={[styles.td, { flex: 0.8 }]}>
                      {v.weightGrams !== null
                        ? (v.weightGrams / 1000).toFixed(1)
                        : '—'}
                    </Text>
                    <Text style={[styles.td, { flex: 0.6 }]}>
                      {v.bmi?.toFixed(1) ?? '—'}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}

        {/* ============== 5. Diagnósticos (CIDs) ============== */}
        <Text style={styles.sectionTitle}>5. Diagnósticos (CID-10)</Text>
        {bundle.diagnostics.length === 0 ? (
          <Text style={styles.empty}>Nenhum diagnóstico cadastrado.</Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.trHeader}>
              <Text style={[styles.th, { flex: 0.6 }]}>Código</Text>
              <Text style={[styles.th, { flex: 3 }]}>Descrição</Text>
              <Text style={[styles.th, { flex: 1 }]}>Status</Text>
              <Text style={[styles.th, { flex: 1 }]}>Diagnosticado em</Text>
            </View>
            {bundle.diagnostics.map((c, idx) => (
              <View key={`${c.code}-${idx}`} style={styles.tr}>
                <Text style={[styles.td, { flex: 0.6, fontFamily: 'Helvetica-Bold' }]}>
                  {c.code}
                </Text>
                <Text style={[styles.td, { flex: 3 }]}>
                  {c.description}
                  {c.additionalNotes ? `\n${c.additionalNotes}` : ''}
                </Text>
                <Text style={[styles.td, { flex: 1 }]}>{formatStatus(c.status)}</Text>
                <Text style={[styles.td, { flex: 1 }]}>{formatDate(c.diagnosedAt)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ============== 6. Evoluções SOAP ============== */}
        <Text style={styles.sectionTitle}>6. Evoluções Clínicas (SOAP)</Text>
        {bundle.evolutions.length === 0 ? (
          <Text style={styles.empty}>Sem evoluções no período.</Text>
        ) : (
          bundle.evolutions
            .slice()
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
            .map((r) => {
              const soap = r.soapData
              if (!soap) return null
              return (
                <View key={r.id} style={styles.block} wrap={false}>
                  <View style={styles.blockHeader}>
                    <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 9 }}>
                      {formatDateTime(r.createdAt)}
                    </Text>
                    <Text style={styles.subtle}>por {r.createdBy.slice(0, 8)}</Text>
                  </View>
                  {(
                    [
                      ['S', 'Subjetivo', soap.subjective],
                      ['O', 'Objetivo', soap.objective],
                      ['A', 'Avaliação', soap.assessment],
                      ['P', 'Plano', soap.plan],
                    ] as Array<[string, string, string | null | undefined]>
                  ).map(([letter, label, value]) =>
                    value && value.toString().trim() ? (
                      <View key={letter} style={styles.soapRow}>
                        <Text style={styles.soapLetter}>{letter}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.label}>{label}</Text>
                          <Text style={styles.value}>{value}</Text>
                        </View>
                      </View>
                    ) : null,
                  )}
                  {soap.assessment_cids && soap.assessment_cids.length > 0 ? (
                    <View style={[styles.soapRow, { marginTop: 2 }]}>
                      <Text style={styles.label}>CIDs · </Text>
                      {soap.assessment_cids.map((c) => (
                        <Text key={c.code} style={[styles.pill, styles.pillBlue]}>
                          {c.code} {c.description}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              )
            })
        )}

        {/* ============== 7. Anamneses ============== */}
        <Text style={styles.sectionTitle}>7. Anamneses</Text>
        {bundle.anamneses.length === 0 ? (
          <Text style={styles.empty}>Sem anamneses no período.</Text>
        ) : (
          bundle.anamneses.map((r) => {
            const a = r.anamnesisData
            if (!a) return null
            // Campos is_default (nome, CPF, plano, alergias etc.) já
            // aparecem nas seções 1 (Dados do paciente) e 2 (Alergias).
            // Filtro apenas na exibição — snapshot continua completo
            // em anamnesis_data.
            const customFields = (a.fields ?? []).filter((f) => !f.is_default)
            if (customFields.length === 0) return null
            return (
              <View key={r.id} style={styles.block} wrap={false}>
                <View style={styles.blockHeader}>
                  <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 9 }}>
                    {a.template_title} · v{a.template_version}
                  </Text>
                  <Text style={styles.subtle}>{formatDateTime(r.createdAt)}</Text>
                </View>
                {customFields.map((f) => {
                  const v = a.responses?.[f.id]
                  const display =
                    v === undefined || v === null || v === ''
                      ? '—'
                      : Array.isArray(v)
                        ? v.map(String).join(', ')
                        : typeof v === 'object'
                          ? JSON.stringify(v)
                          : String(v)
                  return (
                    <Text key={f.id} style={styles.value}>
                      <Text style={{ fontFamily: 'Helvetica-Bold' }}>{f.label}: </Text>
                      {display}
                    </Text>
                  )
                })}
              </View>
            )
          })
        )}

        {/* ============== 8. Plano de tratamento ============== */}
        <Text style={styles.sectionTitle}>8. Plano de Tratamento</Text>
        {bundle.treatmentSteps.length === 0 ? (
          <Text style={styles.empty}>Nenhuma etapa cadastrada.</Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.trHeader}>
              <Text style={[styles.th, { flex: 1.2 }]}>Data prevista</Text>
              <Text style={[styles.th, { flex: 2 }]}>Procedimento</Text>
              <Text style={[styles.th, { flex: 1.5 }]}>Profissional</Text>
              <Text style={[styles.th, { flex: 0.8 }]}>Status</Text>
            </View>
            {bundle.treatmentSteps.map((s) => (
              <View key={s.id} style={styles.tr}>
                <Text style={[styles.td, { flex: 1.2 }]}>
                  {s.scheduledDate ? formatDate(s.scheduledDate) : '—'}
                </Text>
                <Text style={[styles.td, { flex: 2 }]}>
                  {s.title}
                  {s.procedure?.tussCode ? ` · ${s.procedure.tussCode}` : ''}
                </Text>
                <Text style={[styles.td, { flex: 1.5 }]}>
                  {s.doctor?.fullName ?? '—'}
                </Text>
                <Text style={[styles.td, { flex: 0.8 }]}>{s.status}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ============== 9. Atendimentos ============== */}
        <Text style={styles.sectionTitle}>9. Atendimentos</Text>
        {bundle.appointments.length === 0 ? (
          <Text style={styles.empty}>Sem atendimentos no período.</Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.trHeader}>
              <Text style={[styles.th, { flex: 1.4 }]}>Data</Text>
              <Text style={[styles.th, { flex: 2 }]}>Procedimento</Text>
              <Text style={[styles.th, { flex: 1.2 }]}>Profissional</Text>
              <Text style={[styles.th, { flex: 1 }]}>Plano</Text>
              <Text style={[styles.th, { flex: 0.8 }]}>Valor</Text>
              <Text style={[styles.th, { flex: 0.7 }]}>Status</Text>
            </View>
            {bundle.appointments.map((a) => (
              <View key={a.id} style={styles.tr}>
                <Text style={[styles.td, { flex: 1.4 }]}>
                  {formatDateTime(a.appointmentAt)}
                </Text>
                <Text style={[styles.td, { flex: 2 }]}>{a.procedureName ?? '—'}</Text>
                <Text style={[styles.td, { flex: 1.2 }]}>{a.doctorName ?? '—'}</Text>
                <Text style={[styles.td, { flex: 1 }]}>{a.planName ?? '—'}</Text>
                <Text style={[styles.td, { flex: 0.8 }]}>
                  {formatBRL(a.netAmountCents)}
                </Text>
                <Text style={[styles.td, { flex: 0.7 }]}>{a.effectiveStatus ?? '—'}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ============== Footer fixo ============== */}
        <View style={styles.footer} fixed>
          <View style={styles.footerRow}>
            <Text>
              Prontuário gerado em {generated} pelo sistema Prontool.
            </Text>
            <Text
              render={({ pageNumber, totalPages }) =>
                `Página ${pageNumber} de ${totalPages}`
              }
            />
          </View>
          <View style={[styles.signatureLine]} />
          <Text style={{ fontSize: 7, marginTop: 1 }}>
            Assinatura do profissional responsável
          </Text>
          <Text style={{ fontSize: 7, color: '#64748b' }}>
            Nome: ____________________________   Conselho: _______ Nº: __________
          </Text>
        </View>
      </Page>
    </Document>
  )
}

export async function renderProntuarioPdf(
  bundle: ProntuarioBundle,
): Promise<Buffer> {
  return renderToBuffer(<ProntuarioDocument bundle={bundle} />)
}
