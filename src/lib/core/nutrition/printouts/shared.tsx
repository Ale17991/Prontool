/* eslint-disable react/no-unknown-property */
import { StyleSheet, Text, View } from '@react-pdf/renderer'

/**
 * Feature 054 — blocos comuns a todos os impressos da consulta.
 *
 * Existe para que os nove documentos não divirjam entre si: mesma margem, mesmo
 * corpo de texto, mesma forma de dizer "não tem esse dado". Um paciente que
 * recebe o plano e a avaliação na mesma consulta percebe imediatamente quando
 * dois papéis do mesmo sistema parecem de sistemas diferentes.
 */

export const printStyles = StyleSheet.create({
  page: {
    padding: 36,
    paddingBottom: 56,
    fontFamily: 'Helvetica',
    fontSize: 9.5,
    color: '#0f172a',
  },
  h1: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  h2: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    color: '#64748b',
    marginTop: 10,
    marginBottom: 4,
  },
  subtle: { color: '#64748b', fontSize: 8 },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 3,
  },
  head: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
    paddingVertical: 3,
  },
  bold: { fontFamily: 'Helvetica-Bold' },
  right: { textAlign: 'right' },
})

/**
 * Valor pronto para impressão.
 *
 * `null`, `undefined` e `NaN` viram travessão. **Zero permanece zero**, porque
 * "o paciente não comeu gordura nenhuma" e "não medimos a gordura" são coisas
 * diferentes — a mesma distinção que o rótulo nutricional (052) estabeleceu, e
 * que aqui vale para os nove documentos.
 */
export function dash(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—'
    return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  }
  return value.trim() === '' ? '—' : value
}

/** Valor com unidade. Ausente sai como travessão, sem a unidade pendurada. */
export function fmt(value: number | null | undefined, unit?: string): string {
  const base = dash(value)
  if (base === '—' || !unit) return base
  return `${base} ${unit}`
}

/** `2026-08-03` → `03/08/2026`. Aceita ISO completo. */
export function brDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = iso.slice(0, 10).split('-')
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : '—'
}

/**
 * Timestamp → data (ou data e hora) no fuso da clínica.
 *
 * `brDate` serve a colunas `DATE`, que não têm fuso. Orientação e anamnese são
 * `TIMESTAMPTZ`: fatiar os 10 primeiros caracteres devolveria o dia em UTC, e
 * uma orientação escrita às 23h de São Paulo sairia impressa com a data do dia
 * seguinte — divergindo da tela pela qual a profissional a reconhece.
 */
export function brDateTz(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', {
    timeZone: process.env.CLINIC_TIMEZONE || 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit' as const, minute: '2-digit' as const } : {}),
  })
}

/**
 * Rodapé fixo com paginação e responsável pela emissão.
 *
 * `render` do react-pdf entrega o número da página em toda página, e `fixed`
 * repete o bloco — é o que garante FR-015 sem duplicar markup por documento.
 */
export function PrintFooter({
  professionalName,
  issuedAt,
  patientName,
}: {
  professionalName: string
  issuedAt: string
  patientName: string
}) {
  return (
    <View
      fixed
      style={{
        position: 'absolute',
        bottom: 24,
        left: 36,
        right: 36,
        borderTopWidth: 0.5,
        borderTopColor: '#e2e8f0',
        paddingTop: 4,
        flexDirection: 'row',
        justifyContent: 'space-between',
      }}
    >
      <Text style={printStyles.subtle}>
        {patientName} · Emitido por {professionalName} em {brDate(issuedAt)}
      </Text>
      <Text
        style={printStyles.subtle}
        render={({ pageNumber, totalPages }) => `página ${pageNumber} de ${totalPages}`}
      />
    </View>
  )
}

/**
 * Tarja de documento não definitivo.
 *
 * Usada no plano ainda em rascunho: sem ela, um cardápio que a profissional
 * ainda estava ajustando circula como se fosse a prescrição fechada.
 */
export function DraftStamp({ label = 'RASCUNHO — não é a prescrição final' }: { label?: string }) {
  return (
    <View
      style={{
        borderWidth: 1.5,
        borderColor: '#b45309',
        backgroundColor: '#fffbeb',
        padding: 6,
        marginBottom: 10,
      }}
    >
      <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#b45309' }}>{label}</Text>
    </View>
  )
}

/** Dia civil da clínica — o mesmo critério usado nas rotas da vertical. */
export function todayInClinicTz(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.CLINIC_TIMEZONE || 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Idade em anos completos na data de referência. `null` sem nascimento. */
export function ageAt(birthDate: string | null, atIso: string): number | null {
  if (!birthDate) return null
  const [by, bm, bd] = birthDate.slice(0, 10).split('-').map(Number) as [number, number, number]
  const [ay, am, ad] = atIso.slice(0, 10).split('-').map(Number) as [number, number, number]
  if (!Number.isFinite(by) || !Number.isFinite(ay)) return null
  let age = ay - by
  if (am < bm || (am === bm && ad < bd)) age -= 1
  return age >= 0 ? age : null
}
