/* eslint-disable react/no-unknown-property */
import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { ClinicHeader } from '@/lib/pdf/clinic-header'
import type { ClinicProfile } from '@/lib/core/clinic-profile/types'
import type { CareNote } from '@/lib/core/patient-portal/care-notes'
import {
  PatientBlock,
  PrintFooter,
  brDateTz,
  printStyles as s,
  type PatientHeaderInfo,
} from '@/lib/core/nutrition/printouts/shared'

/**
 * Feature 054 US3 — orientações ao paciente em papel.
 *
 * O texto já existe no sistema (feature 032) e é o documento que o paciente
 * mais consulta em casa. Aqui ele só muda de meio: nada é resumido, cortado ou
 * reescrito — uma orientação impressa pela metade é pior que nenhuma, porque
 * parece completa.
 *
 * Os blocos comuns vêm de `nutrition/printouts/shared`: apesar do caminho, são
 * a fundação de todos os nove impressos da feature, e duplicá-los aqui faria
 * este documento divergir dos outros na primeira alteração de margem.
 */

export interface CareNotesPdfInput {
  clinicProfile: ClinicProfile | null
  patient: PatientHeaderInfo
  professionalName: string
  issuedAt: string
  /** Na ordem em que a tela mostra — mais recente primeiro. */
  notes: CareNote[]
}

export async function renderCareNotesPdf(input: CareNotesPdfInput): Promise<Buffer> {
  const { notes, patient } = input

  const doc = (
    <Document>
      <Page size="A4" style={s.page}>
        <ClinicHeader profile={input.clinicProfile} subtitle="Orientações ao paciente" />
        <PatientBlock patient={patient} />

        <Text style={s.h2}>Orientações</Text>

        {notes.map((n) => (
          // `minPresenceAhead` impede que a data fique órfã no pé de uma página
          // com o texto começando na seguinte. O corpo em si pode atravessar
          // páginas — o guia FODMAP tem ~2.900 caracteres e não cabe em uma.
          <View key={n.id} style={{ marginBottom: 12 }} minPresenceAhead={40}>
            <Text style={[s.subtle, s.bold]}>{brDateTz(n.createdAt, true)}</Text>
            <Text style={{ marginTop: 2, lineHeight: 1.4 }}>{n.body}</Text>
          </View>
        ))}

        <PrintFooter
          professionalName={input.professionalName}
          issuedAt={input.issuedAt}
          patientName={patient.name}
        />
      </Page>
    </Document>
  )

  return renderToBuffer(doc)
}
