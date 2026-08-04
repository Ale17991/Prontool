/* eslint-disable react/no-unknown-property */
import { StyleSheet, Text, View } from '@react-pdf/renderer'

/**
 * Feature 054 — layout de avaliações lado a lado.
 *
 * Serve a quatro impressos (antropometria, bioimpedância, avaliação infantil e
 * gestacional) e por isso mora em `src/lib/pdf/`, não dentro de nutrição.
 *
 * O formato existe porque o impresso da consulta não é uma foto do dia: é a
 * trajetória. Ver a coluna de hoje ao lado da de dois meses atrás é o que faz o
 * paciente entender que o trabalho está funcionando — ou que parou. Um número
 * isolado não diz nada a quem não acompanha a própria evolução.
 */

/** Três é o padrão da planilha de referência e o que cabe em A4 retrato. */
export const MAX_EVOLUTION_COLUMNS = 3

export interface EvolutionCell {
  label: string
  /** `null` = não medido. Vira travessão, nunca zero. */
  value: string | null
  classification?: string | null
}

export interface EvolutionColumn {
  /** Rótulo da coluna — a data da avaliação. */
  assessedAt: string
  /**
   * Método que produziu os números.
   *
   * Obrigatório: dobras cutâneas e bioimpedância não são comparáveis entre si,
   * e colocá-las lado a lado sem dizer o método induz o leitor a interpretar
   * como evolução o que é só troca de instrumento.
   */
  protocol: string
  cells: EvolutionCell[]
}

const styles = StyleSheet.create({
  table: { marginTop: 6 },
  head: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 3,
  },
  labelCol: { width: '31%', fontSize: 9 },
  col: { width: '23%', textAlign: 'right', fontSize: 9 },
  colHead: { width: '23%', textAlign: 'right' },
  date: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  proto: { fontSize: 6.5, color: '#64748b' },
  cls: { fontSize: 6.5, color: '#64748b' },
})

/**
 * Seleciona as colunas que vão para o papel: as `MAX_EVOLUTION_COLUMNS` mais
 * recentes, apresentadas da mais antiga para a mais nova.
 *
 * Com menos que isso, devolve só o que existe — coluna vazia sugeriria um
 * histórico que não há, e o paciente leria como "não fui medido naquele mês".
 */
export function pickEvolutionColumns(
  columns: readonly EvolutionColumn[],
  max: number = MAX_EVOLUTION_COLUMNS,
): EvolutionColumn[] {
  const ordenadas = [...columns].sort((a, b) => a.assessedAt.localeCompare(b.assessedAt))
  return ordenadas.slice(Math.max(0, ordenadas.length - max))
}

export function EvolutionColumns({
  columns,
  labels,
}: {
  columns: readonly EvolutionColumn[]
  /** Ordem das linhas. Garante que todas as colunas mostrem as mesmas medidas. */
  labels: readonly string[]
}) {
  const cols = pickEvolutionColumns(columns)
  if (cols.length === 0) return null

  const find = (col: EvolutionColumn, label: string) => col.cells.find((c) => c.label === label)

  return (
    <View style={styles.table}>
      <View style={styles.head}>
        <Text style={styles.labelCol} />
        {cols.map((c) => (
          <View key={c.assessedAt} style={styles.colHead}>
            <Text style={styles.date}>{c.assessedAt}</Text>
            <Text style={styles.proto}>{c.protocol}</Text>
          </View>
        ))}
      </View>

      {labels.map((label) => (
        <View style={styles.row} key={label} wrap={false}>
          <Text style={styles.labelCol}>{label}</Text>
          {cols.map((c) => {
            const cell = find(c, label)
            return (
              <View key={`${c.assessedAt}-${label}`} style={styles.col}>
                <Text>{cell?.value ?? '—'}</Text>
                {cell?.classification ? (
                  <Text style={styles.cls}>{cell.classification}</Text>
                ) : null}
              </View>
            )
          })}
        </View>
      ))}
    </View>
  )
}
