/**
 * Feature 052 — referências normativas da rotulagem nutricional brasileira.
 *
 * Estes números vão para uma EMBALAGEM COMERCIAL. Ficam aqui, em código, e não
 * no banco, de propósito: são ~25 constantes fixadas em norma federal que
 * clínica nenhuma pode editar, e em TypeScript elas ficam versionadas no git,
 * revisáveis em pull request e cobertas por teste — que é o tratamento que um
 * número impresso em rótulo merece. Ver `research.md` D2.
 *
 * Fontes: IN nº 75/2020 (Anexos II, III e IV) e RDC nº 429/2020.
 *
 * CONFERIDO em 2026-08-02 (T033) contra o texto da IN nº 75/2020 em duas fontes
 * independentes que reproduzem o ato na íntegra. Os 10 VDR batem, inclusive o
 * de gorduras trans (2 g) — o número de maior risco, por não existir na RDC
 * 360/2003. A conferência achou um erro: açúcares adicionados NÃO tem limiar de
 * quantidade não significativa (ver `insignificantAtOrBelow`). Registro em
 * `specs/052-rotulo-nutricional/research.md`.
 *
 * NÃO copiar valores da planilha `nutri-doc/AF..xlsm` (aba "Rótulos
 * Nutricionais"): ela usa referências da revogada RDC 360/2003 e declara
 * açúcares adicionados contra 300 g em vez de 50 g, o que subdeclara o %VD de
 * um produto doce em seis vezes.
 */

/** Gravada em cada rótulo (FR-021) para que um documento antigo siga explicável. */
export const NORMATIVE_VERSION = 'IN 75/2020 + RDC 429/2020'

/** De onde o nutriente sai na base de alimentos. */
export type NutrientSource =
  | { kind: 'field'; field: 'energyKcal' | 'proteinG' | 'carbG' | 'fatG' | 'fiberG' }
  | { kind: 'micro'; key: string }

export interface LabelNutrientDef {
  key: string
  label: string
  unit: 'kcal' | 'g' | 'mg'
  /**
   * Valor Diário de Referência (IN 75/2020, Anexo II).
   * `null` = a norma NÃO estabelece VDR → declara-se sem %VD.
   */
  dv: number | null
  /**
   * Anexo IV — quantidade não significativa. Valor calculado igual ou abaixo
   * disso é DECLARADO como zero. Este zero é correto e é coisa diferente de
   * dado desconhecido.
   *
   * `null` = a norma NÃO fixa limite numérico para este nutriente. É o caso de
   * açúcares adicionados, cuja regra do Anexo IV é de CRITÉRIO ("o produto
   * atende ao atributo sem adição de açúcares"), não de grandeza. Sem isso,
   * 0,4 g de açúcar adicionado por 100 g seria declarado como zero — o produto
   * TEM açúcar adicionado, e zerar a linha subdeclara e ainda sugere um
   * atributo nutricional que ele não possui.
   */
  insignificantAtOrBelow: number | null
  source: NutrientSource
  order: number
}

/**
 * Os 10 nutrientes de declaração obrigatória, na ordem da norma.
 * A ordem importa: é a sequência impressa na tabela.
 */
export const LABEL_NUTRIENTS: readonly LabelNutrientDef[] = [
  {
    key: 'energia',
    label: 'Valor energético',
    unit: 'kcal',
    dv: 2000,
    insignificantAtOrBelow: 4,
    source: { kind: 'field', field: 'energyKcal' },
    order: 10,
  },
  {
    key: 'carboidratos',
    label: 'Carboidratos totais',
    unit: 'g',
    dv: 300,
    insignificantAtOrBelow: 0.5,
    source: { kind: 'field', field: 'carbG' },
    order: 20,
  },
  {
    key: 'acucares_totais',
    label: 'Açúcares totais',
    unit: 'g',
    // A norma não estabelece VDR para açúcares totais — declara-se sem %VD.
    dv: null,
    insignificantAtOrBelow: 0.5,
    source: { kind: 'micro', key: 'acucar_total_g' },
    order: 30,
  },
  {
    key: 'acucares_adicionados',
    label: 'Açúcares adicionados',
    unit: 'g',
    dv: 50,
    // Anexo IV não fixa grandeza aqui — a regra é o critério "sem adição de
    // açúcares". Qualquer quantidade calculada é declarada como tal.
    insignificantAtOrBelow: null,
    source: { kind: 'micro', key: 'acucar_adicao_g' },
    order: 40,
  },
  {
    key: 'proteinas',
    label: 'Proteínas',
    unit: 'g',
    dv: 50,
    insignificantAtOrBelow: 0.5,
    source: { kind: 'field', field: 'proteinG' },
    order: 50,
  },
  {
    key: 'gorduras_totais',
    label: 'Gorduras totais',
    unit: 'g',
    dv: 65,
    insignificantAtOrBelow: 0.5,
    source: { kind: 'field', field: 'fatG' },
    order: 60,
  },
  {
    key: 'gorduras_saturadas',
    label: 'Gorduras saturadas',
    unit: 'g',
    dv: 20,
    insignificantAtOrBelow: 0.1,
    source: { kind: 'micro', key: 'ag_saturados_g' },
    order: 70,
  },
  {
    key: 'gorduras_trans',
    label: 'Gorduras trans',
    unit: 'g',
    dv: 2,
    insignificantAtOrBelow: 0.1,
    source: { kind: 'micro', key: 'ag_trans_g' },
    order: 80,
  },
  {
    key: 'fibra_alimentar',
    label: 'Fibra alimentar',
    unit: 'g',
    dv: 25,
    insignificantAtOrBelow: 0.5,
    source: { kind: 'field', field: 'fiberG' },
    order: 90,
  },
  {
    key: 'sodio',
    label: 'Sódio',
    unit: 'mg',
    dv: 2000,
    insignificantAtOrBelow: 5,
    source: { kind: 'micro', key: 'sodio_mg' },
    order: 100,
  },
] as const

const BY_KEY = new Map(LABEL_NUTRIENTS.map((n) => [n.key, n]))

export function labelNutrient(key: string): LabelNutrientDef | undefined {
  return BY_KEY.get(key)
}

/** Base de declaração: sólido usa 100 g, líquido usa 100 mL. */
export type LabelBasis = 'solido' | 'liquido'

/** Nutrientes sujeitos à rotulagem nutricional frontal (a "lupa"). */
export type FrontOfPackNutrient = 'acucares_adicionados' | 'gorduras_saturadas' | 'sodio'

/**
 * RDC 429/2020 — limites acima dos quais a embalagem MUST trazer a marca
 * "ALTO EM". Por 100 g (sólidos) ou por 100 mL (líquidos).
 *
 * A comparação é **maior ou igual**: um produto com exatamente 15 g de
 * açúcares adicionados por 100 g já se enquadra.
 */
export const FRONT_OF_PACK: Readonly<
  Record<FrontOfPackNutrient, { solido: number; liquido: number }>
> = {
  acucares_adicionados: { solido: 15, liquido: 7.5 }, // g
  gorduras_saturadas: { solido: 6, liquido: 3 }, // g
  sodio: { solido: 600, liquido: 300 }, // mg
}

export const FRONT_OF_PACK_NUTRIENTS = Object.keys(FRONT_OF_PACK) as FrontOfPackNutrient[]

/** Texto da marca frontal, para tela e impressão. */
export const FRONT_OF_PACK_LABEL: Readonly<Record<FrontOfPackNutrient, string>> = {
  acucares_adicionados: 'ALTO EM AÇÚCAR ADICIONADO',
  gorduras_saturadas: 'ALTO EM GORDURA SATURADA',
  sodio: 'ALTO EM SÓDIO',
}
