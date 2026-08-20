/**
 * Feature 049 — catálogo canônico de micronutrientes.
 *
 * Fonte das colunas: aba `BD ALIMENTOS` de `nutri-doc/AF..xlsm` (valores por
 * 100 g). Cada micro tem uma `key` estável (usada no JSONB `foods.micronutrients`
 * e na soma), `label`/`unit` para exibição, `col` (número da coluna 1-based no
 * ExcelJS, para o script de importação) e `driKey` opcional (liga à tabela de
 * DRIs para a análise de adequação).
 *
 * Puro/sem dependências — usado no servidor (importação, soma, adequação) e no
 * cliente (exibição). Chave ausente no alimento = dado desconhecido (não zero).
 */

export interface MicronutrientDef {
  key: string
  label: string
  unit: 'mg' | 'mcg' | 'g'
  /** Coluna 1-based na aba BD ALIMENTOS (ExcelJS getCell). */
  col: number
  /** Chave da DRI correspondente (quando há recomendação). */
  driKey?: string
}

export const MICRONUTRIENTS: readonly MicronutrientDef[] = [
  { key: 'calcio_mg', label: 'Cálcio', unit: 'mg', col: 10, driKey: 'calcio' },
  { key: 'magnesio_mg', label: 'Magnésio', unit: 'mg', col: 11, driKey: 'magnesio' },
  { key: 'manganes_mg', label: 'Manganês', unit: 'mg', col: 12, driKey: 'manganes' },
  { key: 'fosforo_mg', label: 'Fósforo', unit: 'mg', col: 13, driKey: 'fosforo' },
  { key: 'ferro_mg', label: 'Ferro', unit: 'mg', col: 14, driKey: 'ferro' },
  { key: 'sodio_mg', label: 'Sódio', unit: 'mg', col: 15, driKey: 'sodio' },
  { key: 'sodio_adicao_mg', label: 'Sódio de adição', unit: 'mg', col: 16 },
  { key: 'potassio_mg', label: 'Potássio', unit: 'mg', col: 17, driKey: 'potassio' },
  { key: 'cobre_mg', label: 'Cobre', unit: 'mg', col: 18, driKey: 'cobre' },
  { key: 'zinco_mg', label: 'Zinco', unit: 'mg', col: 19, driKey: 'zinco' },
  { key: 'selenio_mcg', label: 'Selênio', unit: 'mcg', col: 20, driKey: 'selenio' },
  { key: 'retinol_mcg', label: 'Retinol', unit: 'mcg', col: 21 },
  { key: 'vitamina_a_mcg', label: 'Vitamina A', unit: 'mcg', col: 22, driKey: 'vitamina_a' },
  { key: 'vitamina_b1_mg', label: 'Tiamina (B1)', unit: 'mg', col: 23, driKey: 'vitamina_b1' },
  { key: 'vitamina_b2_mg', label: 'Riboflavina (B2)', unit: 'mg', col: 24, driKey: 'vitamina_b2' },
  { key: 'vitamina_b3_mg', label: 'Niacina (B3)', unit: 'mg', col: 25, driKey: 'vitamina_b3' },
  { key: 'niacina_eq_mg', label: 'Equivalente de niacina', unit: 'mg', col: 26 },
  { key: 'vitamina_b6_mg', label: 'Piridoxina (B6)', unit: 'mg', col: 27, driKey: 'vitamina_b6' },
  {
    key: 'vitamina_b12_mcg',
    label: 'Cobalamina (B12)',
    unit: 'mcg',
    col: 28,
    driKey: 'vitamina_b12',
  },
  { key: 'folato_mcg', label: 'Folato', unit: 'mcg', col: 29, driKey: 'folato' },
  { key: 'vitamina_d_mcg', label: 'Vitamina D', unit: 'mcg', col: 30, driKey: 'vitamina_d' },
  { key: 'vitamina_e_mg', label: 'Vitamina E', unit: 'mg', col: 31, driKey: 'vitamina_e' },
  { key: 'vitamina_c_mg', label: 'Vitamina C', unit: 'mg', col: 32, driKey: 'vitamina_c' },
  { key: 'colesterol_mg', label: 'Colesterol', unit: 'mg', col: 33 },
  { key: 'ag_saturados_g', label: 'Ácidos graxos saturados', unit: 'g', col: 34 },
  { key: 'ag_monoinsaturados_g', label: 'Ácidos graxos monoinsaturados', unit: 'g', col: 35 },
  { key: 'ag_poliinsaturados_g', label: 'Ácidos graxos poli-insaturados', unit: 'g', col: 36 },
  { key: 'ag_18_2_g', label: 'Ácido graxo 18:2', unit: 'g', col: 37 },
  { key: 'ag_18_3_g', label: 'Ácido graxo 18:3', unit: 'g', col: 38 },
  { key: 'ag_trans_g', label: 'Gordura trans', unit: 'g', col: 39 },
  { key: 'acucar_total_g', label: 'Açúcar total', unit: 'g', col: 40 },
  { key: 'acucar_adicao_g', label: 'Açúcar de adição', unit: 'g', col: 41 },
] as const

export const MICRONUTRIENT_KEYS: readonly string[] = MICRONUTRIENTS.map((m) => m.key)

const BY_KEY = new Map(MICRONUTRIENTS.map((m) => [m.key, m]))
export function micronutrientDef(key: string): MicronutrientDef | undefined {
  return BY_KEY.get(key)
}

/** Micros considerados "principais" para exibição compacta (resumo). */
export const MICRONUTRIENTS_PRIMARY: readonly string[] = [
  'ferro_mg',
  'calcio_mg',
  'sodio_mg',
  'potassio_mg',
  'vitamina_c_mg',
  'vitamina_a_mcg',
  'colesterol_mg',
]

export type MicronutrientMap = Record<string, number>
