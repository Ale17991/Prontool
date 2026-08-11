/* eslint-disable react/no-unknown-property */
import { StyleSheet, Text, View } from '@react-pdf/renderer'
import type { PatientIdentity } from '@/lib/core/printouts/patient-identity'

/**
 * Identificação do paciente, igual em todo impresso.
 *
 * Mora em `src/lib/pdf/` e não no módulo de nutrição de propósito: o bloco que a
 * 054 criou ficou preso à vertical, e o resultado foi pedido de exame, receita
 * de óculos, orçamento odontológico e laudo oftalmológico imprimindo cada um a
 * sua linha `Paciente: {nome}` à mão. Treze documentos que identificam a mesma
 * pessoa precisam identificá-la do mesmo jeito — inclusive porque o paciente
 * costuma receber mais de um na mesma consulta.
 *
 * Estilo próprio, não herdado do documento: é o que garante que a
 * identificação não mude de cara conforme a especialidade que a emitiu.
 */

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  name: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  nameCompact: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 1 },
  lines: { color: '#64748b', fontSize: 8, lineHeight: 1.35 },
})

/**
 * `—` para campo escolhido sem dado no cadastro.
 *
 * Some não é opção: a clínica ligou aquele campo afirmando que ele importa
 * naquele documento, e omitir a linha devolve um papel que parece completo
 * escondendo o que não foi coletado. Mesma regra que a 054 aplicou às perguntas
 * de anamnese sem resposta.
 */
function text(value: string | null): string {
  return value === null || value === '' ? '—' : value
}

export function PatientIdentityBlock({
  identity,
  compact = false,
}: {
  identity: PatientIdentity
  /** Documento de pouco espaço (etiqueta, receita curta). */
  compact?: boolean
}) {
  return (
    <View style={styles.wrap}>
      <Text style={compact ? styles.nameCompact : styles.name}>{identity.name}</Text>
      {identity.lines.length > 0 ? (
        <Text style={styles.lines}>
          {identity.lines.map((l) => `${l.label}: ${text(l.value)}`).join('  ·  ')}
        </Text>
      ) : null}
    </View>
  )
}
