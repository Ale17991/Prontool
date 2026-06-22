/**
 * Backlog 2/2 — placeholders dos modelos de laudo. Sintaxe {{chave}}; chave
 * desconhecida → vazio. Reusa o mesmo motor de substituição dos modelos de
 * documento, com um catálogo de variáveis específico do exame oftalmológico.
 */
export { substitutePlaceholders } from '@/lib/core/document-templates/placeholders'

/** Placeholders disponíveis no editor de modelos de laudo oftalmológico. */
export const EXAM_REPORT_PLACEHOLDERS: Array<{ key: string; label: string }> = [
  { key: 'paciente.nome', label: 'Nome do paciente' },
  { key: 'paciente.idade', label: 'Idade' },
  { key: 'exame.data', label: 'Data do exame' },
  { key: 'exame.av_od_sc', label: 'AV OD sem correção' },
  { key: 'exame.av_od_cc', label: 'AV OD com correção' },
  { key: 'exame.av_oe_sc', label: 'AV OE sem correção' },
  { key: 'exame.av_oe_cc', label: 'AV OE com correção' },
  { key: 'exame.refr_od', label: 'Refração OD (esf/cil/eixo)' },
  { key: 'exame.refr_oe', label: 'Refração OE (esf/cil/eixo)' },
  { key: 'exame.pio_od', label: 'PIO OD' },
  { key: 'exame.pio_oe', label: 'PIO OE' },
  { key: 'clinica.nome', label: 'Nome da clínica' },
  { key: 'data', label: 'Data de hoje' },
]
