import { describe, expect, it } from 'vitest'
import {
  ANALYTE_BY_NAME,
  ANALYTE_BY_SOURCE_COD,
  LAB_ANALYTES,
  LAB_GROUPS,
  isLabAnalyte,
  labAnalyte,
  normalizeAnalyteName,
} from '@/lib/core/labs/catalog'
import { CANONICAL_UNITS, normalizeUnit, tryNormalizeUnit } from '@/lib/core/labs/units'

/**
 * Feature 050 (T004) — coerência do catálogo de exames.
 *
 * O catálogo é gerado a partir da planilha e semeado em `patient_metric_types`
 * pela migration 0184. Estas garantias existem porque uma quebra aqui só
 * apareceria como erro de INSERT em produção.
 */

/** Mesmo CHECK de `patient_metric_types.metric_type` (migration 0113). */
const METRIC_TYPE_RE = /^[a-z][a-z0-9_]{1,63}$/

/** Chaves já semeadas na 0113 — não podem ser recriadas com prefixo `lab_`. */
const LEGACY_KEYS = ['glicemia_jejum', 'hba1c', 'colesterol_total', 'ldl', 'hdl', 'triglicerides']

describe('catálogo de exames laboratoriais', () => {
  it('tem analitos', () => {
    expect(LAB_ANALYTES.length).toBeGreaterThan(50)
  })

  it('toda chave respeita o CHECK de patient_metric_types', () => {
    for (const a of LAB_ANALYTES) {
      expect(a.key, `chave inválida: ${a.key}`).toMatch(METRIC_TYPE_RE)
    }
  })

  it('não há chave duplicada', () => {
    const keys = LAB_ANALYTES.map((a) => a.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('reusa a chave legada dos exames já semeados na 0113, sem prefixo lab_', () => {
    const keys = new Set(LAB_ANALYTES.map((a) => a.key))
    for (const legacy of LEGACY_KEYS) {
      expect(keys.has(`lab_${legacy}`), `chave duplicada para ${legacy}`).toBe(false)
    }
    for (const legacy of LEGACY_KEYS) {
      expect(keys.has(legacy), `legado ausente: ${legacy}`).toBe(true)
    }
  })

  it('toda unidade é canônica e cabe no CHECK de 16 chars', () => {
    for (const a of LAB_ANALYTES) {
      expect(() => normalizeUnit(a.unit), `unidade não canônica em ${a.key}: ${a.unit}`).not.toThrow()
      expect(normalizeUnit(a.unit)).toBe(a.unit)
      expect(a.unit.length).toBeLessThanOrEqual(16)
    }
  })

  it('todo label e grupo são não-vazios', () => {
    for (const a of LAB_ANALYTES) {
      expect(a.label.trim().length).toBeGreaterThan(0)
      expect(a.group.trim().length).toBeGreaterThan(0)
    }
  })

  it('displayOrder é único (ordenação estável na tela)', () => {
    const orders = LAB_ANALYTES.map((a) => a.displayOrder)
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('labAnalyte/isLabAnalyte resolvem pela chave', () => {
    const first = LAB_ANALYTES[0]!
    expect(labAnalyte(first.key)).toEqual(first)
    expect(isLabAnalyte(first.key)).toBe(true)
    expect(labAnalyte('nao_existe')).toBeUndefined()
    expect(isLabAnalyte('peso')).toBe(false)
  })

  it('ANALYTE_BY_NAME casa label e todos os aliases', () => {
    for (const a of LAB_ANALYTES) {
      expect(ANALYTE_BY_NAME.get(normalizeAnalyteName(a.label))).toBe(a.key)
      for (const alias of a.aliases ?? []) {
        expect(ANALYTE_BY_NAME.get(normalizeAnalyteName(alias)), `alias ${alias}`).toBe(a.key)
      }
    }
  })

  it('sinônimos da planilha convergem para o mesmo analito', () => {
    // Casos reais da fonte: o mesmo exame aparece com dois nomes.
    expect(ANALYTE_BY_NAME.get(normalizeAnalyteName('T4 livre'))).toBe(
      ANALYTE_BY_NAME.get(normalizeAnalyteName('Tiroxina livre (T4 livre)')),
    )
    expect(ANALYTE_BY_NAME.get(normalizeAnalyteName('LDL'))).toBe(
      ANALYTE_BY_NAME.get(normalizeAnalyteName('Lipoproteína de baixa densidade (LDL)')),
    )
    expect(ANALYTE_BY_NAME.get(normalizeAnalyteName('Testosterona'))).toBe(
      ANALYTE_BY_NAME.get(normalizeAnalyteName('Testosterona total')),
    )
  })

  it('cálcio total e cálcio iônico são analitos distintos, resolvidos por Cod', () => {
    // Homônimos na planilha com faixas diferentes (9,3–10,2 vs 4,55–5,12 mg/dL):
    // são exames diferentes, não duplicata. O nome não distingue os dois
    // ("Cálcio" e "Cálcio (total e iônico)" normalizam igual), então quem
    // desempata é o `Cod Exame` da fonte.
    expect(labAnalyte('lab_calcio_total')).toBeDefined()
    expect(labAnalyte('lab_calcio_ionico')).toBeDefined()
    expect(ANALYTE_BY_SOURCE_COD.get(45)).toBe('lab_calcio_total')
    expect(ANALYTE_BY_SOURCE_COD.get(46)).toBe('lab_calcio_ionico')
  })

  it('nenhum nome do índice aponta para dois analitos', () => {
    // ANALYTE_BY_NAME é um Map: colisão seria silenciosa (último vence). Esta
    // asserção prova que nomes ambíguos foram excluídos do índice, não sobrescritos.
    const seen = new Map<string, string>()
    for (const a of LAB_ANALYTES) {
      for (const n of [a.label, ...(a.aliases ?? [])]) {
        const k = normalizeAnalyteName(n)
        const prev = seen.get(k)
        expect(prev === undefined || prev === a.key, `nome "${n}" em ${prev} e ${a.key}`).toBe(true)
        seen.set(k, a.key)
      }
    }
  })

  it('o perfil lipídico inteiro vive num painel só', () => {
    // A planilha espalhava os lipídios entre "Perfil Lipídico" e "Função
    // Cardíaca" (LDL num, HDL e triglicérides no outro) — o exame chegava
    // partido em duas listas na tela.
    for (const key of ['colesterol_total', 'ldl', 'hdl', 'triglicerides']) {
      expect(labAnalyte(key)?.group, `${key} fora do perfil lipídico`).toBe('Perfil Lipídico')
    }
  })

  it('todo exame legado da 0113 está no catálogo, inclusive o sem faixa', () => {
    // `colesterol_total` não tem faixa na fonte, mas precisa estar aqui: fora do
    // catálogo ele ficaria órfão na seção "Métricas metabólicas" enquanto o
    // resto do perfil lipídico vive em "Exames laboratoriais".
    for (const legacy of LEGACY_KEYS) {
      expect(isLabAnalyte(legacy), `legado ausente do catálogo: ${legacy}`).toBe(true)
    }
  })

  it('LAB_GROUPS cobre todos os grupos usados, sem repetir', () => {
    const used = new Set(LAB_ANALYTES.map((a) => a.group))
    expect(new Set(LAB_GROUPS).size).toBe(LAB_GROUPS.length)
    expect(new Set(LAB_GROUPS)).toEqual(used)
  })

  it('normalizeAnalyteName ignora acento, caixa e parênteses', () => {
    expect(normalizeAnalyteName('Ácido Fólico')).toBe('acido folico')
    expect(normalizeAnalyteName('Fosfatase alcalina (FA)')).toBe('fosfatase alcalina')
  })
})

describe('normalização de unidades', () => {
  it('aceita as canônicas como ponto fixo', () => {
    for (const u of CANONICAL_UNITS) expect(normalizeUnit(u)).toBe(u)
  })

  it('limpa espaços e caixa da fonte', () => {
    expect(normalizeUnit(' U/L')).toBe('U/L')
    expect(normalizeUnit(' g/dL')).toBe('g/dL')
    expect(normalizeUnit('mg/dL ')).toBe('mg/dL')
    expect(normalizeUnit('mcg/Ml')).toBe('mcg/mL')
  })

  it('unifica grafias equivalentes de micro', () => {
    expect(normalizeUnit('µg/dL')).toBe('mcg/dL')
    expect(normalizeUnit('µg/L')).toBe('mcg/L')
    expect(normalizeUnit('umol/L')).toBe('µmol/L')
  })

  it('trata µUI/mL como mUI/L (mesma grandeza)', () => {
    expect(normalizeUnit('mcUI/mL')).toBe('mUI/L')
    expect(normalizeUnit('mUI/L')).toBe('mUI/L')
  })

  it('NÃO confunde mIU/mL com mUI/L (diferem por 10³)', () => {
    expect(normalizeUnit('mIU/mL')).toBe('mIU/mL')
    expect(normalizeUnit('mIU/mL')).not.toBe(normalizeUnit('mUI/L'))
  })

  it('unifica mg/dia com mg/24h', () => {
    expect(normalizeUnit('mg/dia')).toBe('mg/24h')
  })

  it('lança em unidade desconhecida, em vez de inventar', () => {
    expect(() => normalizeUnit('bananas/dL')).toThrow(/desconhecida/i)
    expect(() => normalizeUnit('')).toThrow()
    expect(tryNormalizeUnit('bananas/dL')).toBeNull()
  })
})
