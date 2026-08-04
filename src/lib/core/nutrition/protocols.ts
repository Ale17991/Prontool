/**
 * Feature 046 — catálogo (metadados) dos protocolos de composição corporal e
 * das equações de gasto energético. Fonte: `nutri-doc/formulas-referencia.md`.
 *
 * Puro e isomórfico: usado no cliente para montar o formulário (quais dobras
 * exibir por protocolo/sexo) e no servidor para validar as entradas.
 */

import type { Sex } from './age-sex'

// =========================================================================
// Composição corporal (dobras)
// =========================================================================

export type SkinfoldSite =
  | 'triceps'
  | 'biceps'
  | 'subescapular'
  | 'suprailiaca'
  | 'peitoral'
  | 'axilar_media'
  | 'abdominal'
  | 'coxa'
  | 'panturrilha'

export type CircumferenceSite =
  | 'cintura'
  | 'quadril'
  | 'abdomen'
  /** 2ª medida abdominal — Weltman usa a MÉDIA de abdômen 1 e 2. */
  | 'abdomen2'
  | 'braco'
  | 'panturrilha'
  | 'pescoco'

export type DobraProtocol =
  | 'durnin_womersley'
  | 'guedes'
  | 'jp3'
  | 'jp7'
  | 'petroski'
  | 'faulkner'
  | 'weltman'
  | 'mcardle'
  | 'slaughter'
  | 'bioimpedancia'

export interface ProtocolMeta {
  slug: DobraProtocol
  label: string
  /** Sítios de dobra exigidos por sexo. Vazio = não usa dobras. */
  sites: Record<Sex, SkinfoldSite[]>
  /** Circunferências exigidas (ex.: Weltman usa abdômen). */
  circumferences?: Record<Sex, CircumferenceSite[]>
  /** Precisa de altura (ex.: Weltman feminino). */
  needsHeight?: boolean
  /** Faixa etária recomendada (aviso, não bloqueio rígido). */
  ageMin?: number
  ageMax?: number
  /** Entrada direta de %gordura (bioimpedância) — não calcula por dobras. */
  directFatInput?: boolean
  /** Citação da publicação de origem, exibida junto do resultado. */
  source?: string
}

export const DOBRA_PROTOCOLS: Record<DobraProtocol, ProtocolMeta> = {
  durnin_womersley: {
    slug: 'durnin_womersley',
    label: 'Durnin & Womersley (1974)',
    source: 'Durnin & Womersley, Br J Nutr 1974;32:77-97 (equação agrupada)',
    sites: {
      M: ['biceps', 'triceps', 'subescapular', 'suprailiaca'],
      F: ['biceps', 'triceps', 'subescapular', 'suprailiaca'],
    },
    ageMin: 16,
    ageMax: 72,
  },
  guedes: {
    slug: 'guedes',
    label: 'Guedes (1985)',
    source: 'Guedes, 1995 — amostra brasileira; sítios distintos por sexo',
    sites: {
      M: ['triceps', 'abdominal', 'suprailiaca'],
      F: ['subescapular', 'suprailiaca', 'coxa'],
    },
    ageMin: 18,
    ageMax: 30,
  },
  jp3: {
    slug: 'jp3',
    label: 'Jackson-Pollock-Ward 3 dobras (1980)',
    source: 'Jackson & Pollock 1978 (H) / Jackson, Pollock & Ward 1980 (M)',
    sites: {
      M: ['peitoral', 'abdominal', 'coxa'],
      F: ['triceps', 'suprailiaca', 'coxa'],
    },
    ageMin: 18,
  },
  jp7: {
    slug: 'jp7',
    label: 'Jackson-Pollock-Ward 7 dobras (1980)',
    source: 'Jackson & Pollock 1978 / Jackson, Pollock & Ward 1980',
    sites: {
      M: ['triceps', 'peitoral', 'axilar_media', 'subescapular', 'abdominal', 'suprailiaca', 'coxa'],
      F: ['triceps', 'peitoral', 'axilar_media', 'subescapular', 'abdominal', 'suprailiaca', 'coxa'],
    },
    ageMin: 18,
  },
  petroski: {
    slug: 'petroski',
    label: 'Petroski (1995)',
    source: 'Petroski, tese UFSM 1995 — equações distintas por sexo',
    sites: {
      M: ['triceps', 'subescapular', 'suprailiaca', 'panturrilha'],
      F: ['axilar_media', 'suprailiaca', 'coxa', 'panturrilha'],
    },
    ageMin: 18,
    ageMax: 66,
  },
  faulkner: {
    slug: 'faulkner',
    label: 'Faulkner (1987)',
    sites: {
      M: ['triceps', 'subescapular', 'abdominal', 'suprailiaca'],
      F: ['triceps', 'subescapular', 'abdominal', 'suprailiaca'],
    },
    ageMin: 18,
  },
  weltman: {
    slug: 'weltman',
    label: 'Weltman & col. (1988)',
    sites: { M: [], F: [] },
    // Uma medida só, como no documento de base (decisão de 2026-08-03).
    circumferences: { M: ['abdomen'], F: ['abdomen'] },
    needsHeight: true,
    ageMin: 20,
    ageMax: 68,
  },
  mcardle: {
    slug: 'mcardle',
    label: 'McArdle (1992) — 9 a 16 anos',
    sites: { M: ['triceps', 'subescapular'], F: ['triceps', 'subescapular'] },
    ageMin: 9,
    ageMax: 16,
  },
  slaughter: {
    slug: 'slaughter',
    label: 'Slaughter (1988) — 7 a 18 anos',
    sites: { M: ['triceps', 'subescapular'], F: ['triceps', 'subescapular'] },
    ageMin: 7,
    ageMax: 18,
  },
  bioimpedancia: {
    slug: 'bioimpedancia',
    label: 'Bioimpedância',
    sites: { M: [], F: [] },
    directFatInput: true,
  },
}

// =========================================================================
// Gasto energético (equações de TMB/GEB)
// =========================================================================

export type TmbEquation =
  | 'harris_benedict_1919'
  | 'harris_benedict_1984'
  | 'mifflin'
  | 'fao_who_1985'
  | 'fao_who_2004'
  | 'schofield'
  | 'henry_rees'
  | 'cunningham'
  | 'tinsley_peso'
  | 'tinsley_mlg'
  | 'katch_mcardle'
  | 'eer_iom_2005'
  | 'eer_iom_2005_planilha'
  | 'eer_2023'
  | 'eer_gestante'
  | 'eer_lactante_0_6'
  | 'eer_lactante_7_12'

export interface TmbMeta {
  slug: TmbEquation
  label: string
  /** Usa massa livre de gordura (exige composição corporal). */
  usesLeanMass?: boolean
  /** Usa altura. */
  usesHeight?: boolean
  /**
   * É uma equação EER: já resulta no gasto total (não multiplica por PAL).
   * `pa` = coeficiente multiplicativo (EER 2005); `category` = categoria 1–4 (EER 2023).
   */
  eer?: 'pa' | 'category'
  /** Só para mulheres (gestante/lactante). */
  femaleOnly?: boolean
  /**
   * Citação da publicação de origem, exibida junto do resultado.
   *
   * Não é enfeite acadêmico: prontuário exige rastreabilidade do método, e a
   * nutricionista precisa saber qual equação e de que ano gerou o número para
   * poder conferir contra a referência dela.
   */
  source?: string
}

export const TMB_EQUATIONS: Record<TmbEquation, TmbMeta> = {
  harris_benedict_1919: {
    slug: 'harris_benedict_1919',
    label: 'Harris-Benedict (1919)',
    usesHeight: true,
    source: 'Harris & Benedict, Carnegie Institution, 1919',
  },
  harris_benedict_1984: {
    slug: 'harris_benedict_1984',
    label: 'Harris-Benedict revisada (1984)',
    usesHeight: true,
    source: 'Roza & Shizgal, Am J Clin Nutr 1984;40(1):168-82',
  },
  mifflin: {
    slug: 'mifflin',
    label: 'Mifflin-St Jeor (1990)',
    usesHeight: true,
    source: 'Mifflin et al., Am J Clin Nutr 1990;51(2):241-7',
  },
  fao_who_1985: {
    slug: 'fao_who_1985',
    label: 'FAO/OMS/UNU (1985)',
    source: 'FAO/WHO/UNU, WHO Technical Report Series 724, 1985',
  },
  fao_who_2004: {
    slug: 'fao_who_2004',
    label: 'FAO/OMS (2004) — peso',
    source: 'FAO, Human Energy Requirements, 2004 (readota Schofield peso)',
  },
  schofield: {
    slug: 'schofield',
    label: 'Schofield (1985) — peso',
    usesHeight: true,
    source: 'Schofield, Hum Nutr Clin Nutr 1985;39C Suppl 1:5-41',
  },
  henry_rees: {
    slug: 'henry_rees',
    label: 'Henry-Rees (1991)',
    source: 'Henry & Rees, Eur J Clin Nutr 1991;45:177-85 (3-60 anos)',
  },
  // Cunningham 1980 e 1991 são a MESMA linhagem: a de 1991 é revisão do próprio
  // autor, popularizada como "Katch-McArdle" pelo livro-texto de McArdle/Katch.
  // Rotular como escolas distintas fazia a nutricionista ler os 156 kcal/dia de
  // diferença como divergência metodológica, quando é atualização de amostra.
  cunningham: {
    slug: 'cunningham',
    label: 'Cunningham (1980) — MLG',
    usesLeanMass: true,
    source: 'Cunningham, Am J Clin Nutr 1980;33(11):2372-4 (reanálise de Harris-Benedict)',
  },
  katch_mcardle: {
    slug: 'katch_mcardle',
    label: 'Cunningham (1991) — MLG · "Katch-McArdle"',
    usesLeanMass: true,
    source: 'Cunningham, Am J Clin Nutr 1991;54(6):963-9 — revisão da de 1980',
  },
  tinsley_peso: {
    slug: 'tinsley_peso',
    label: 'Tinsley — por peso (2019)',
    source: 'Tinsley et al., Appl Physiol Nutr Metab 2019;44(4):397-406 (atletas)',
  },
  tinsley_mlg: {
    slug: 'tinsley_mlg',
    label: 'Tinsley — por massa magra (2019)',
    usesLeanMass: true,
    source: 'Tinsley et al., Appl Physiol Nutr Metab 2019;44(4):397-406 (atletas)',
  },
  eer_iom_2005: {
    slug: 'eer_iom_2005',
    label: 'EER/IOM (2005)',
    usesHeight: true,
    eer: 'pa',
    source: 'IOM, DRI for Energy…, 2005, cap. 5 — já é o gasto total',
  },
  eer_iom_2005_planilha: {
    slug: 'eer_iom_2005_planilha',
    label: 'EER/IOM (2005) — variante da planilha de referência',
    usesHeight: true,
    eer: 'pa',
    source:
      'Variante em uso na planilha de trabalho da clínica: o fator de atividade multiplica apenas o peso, a altura entra fora do fator, e há um acréscimo fixo por sexo e faixa etária. Difere da forma publicada pelo IOM em 300 a 400 kcal/dia — escolha deliberada de quem usa esta metodologia.',
  },
  eer_2023: {
    slug: 'eer_2023',
    label: 'EER/NASEM (2023)',
    usesHeight: true,
    eer: 'category',
    source: 'NASEM, DRI for Energy, 2023, cap. 5 — já é o gasto total',
  },
  eer_gestante: {
    slug: 'eer_gestante',
    label: 'EER Gestante (2023)',
    usesHeight: true,
    eer: 'category',
    femaleOnly: true,
    source: 'NASEM, DRI for Energy, 2023, Tab. 5-5 — 2º/3º trimestre',
  },
  eer_lactante_0_6: {
    slug: 'eer_lactante_0_6',
    label: 'EER Lactante 0–6 meses (2023)',
    usesHeight: true,
    eer: 'category',
    femaleOnly: true,
    source: 'NASEM, DRI for Energy, 2023',
  },
  eer_lactante_7_12: {
    slug: 'eer_lactante_7_12',
    label: 'EER Lactante 7–12 meses (2023)',
    usesHeight: true,
    eer: 'category',
    femaleOnly: true,
    source: 'NASEM, DRI for Energy, 2023',
  },
}

/** Fator de atividade (PAL) clássico — multiplicador do TMB para equações não-EER. */
export const ACTIVITY_FACTORS: { value: number; label: string }[] = [
  { value: 1.2, label: 'Sedentário' },
  { value: 1.375, label: 'Leve' },
  { value: 1.55, label: 'Moderada' },
  { value: 1.725, label: 'Intensa' },
  { value: 1.9, label: 'Muito intensa' },
]

/**
 * Fator de injúria/estresse.
 *
 * As 25 condições do documento de base (`Evonut.xlsm`, aba Calc_GastoEnerg,
 * colunas Condição clínica / FI / FI média), uma por linha e com o valor MÉDIO
 * da faixa — que é o que a planilha aplica. O `range` guarda a faixa publicada,
 * porque a profissional às vezes precisa justificar por que usou o extremo.
 *
 * Antes esta lista agrupava condições diferentes na mesma linha e OMITIA quatro
 * delas. Duas das omitidas eram as únicas com fator ABAIXO de 1 — doença
 * cardiopulmonar e jejum/inanição —, ou seja, justamente os casos em que o
 * gasto DIMINUI. Sem elas, o cálculo só sabia aumentar.
 */
export const INJURY_FACTORS: { value: number; label: string; range?: string }[] = [
  { value: 1.0, label: 'Paciente não complicado' },
  { value: 0.9, label: 'Doença cardiopulmonar', range: '0,8 a 1,0' },
  { value: 0.925, label: 'Jejum ou inanição', range: '0,85 a 1,0' },
  { value: 1.05, label: 'Cirurgia eletiva', range: '1,0 a 1,1' },
  { value: 1.1, label: 'Pós-operatório' },
  { value: 1.2, label: 'Fratura' },
  { value: 1.2, label: 'Pequena cirurgia' },
  { value: 1.25, label: 'PO cirurgia geral', range: '1,0 a 1,5' },
  { value: 1.25, label: 'Queimadura até 20%', range: '1,0 a 1,5' },
  { value: 1.255, label: 'Pequeno trauma de tecido', range: '1,14 a 1,37' },
  { value: 1.275, label: 'Câncer', range: '1,1 a 1,45' },
  { value: 1.275, label: 'Fraturas múltiplas', range: '1,2 a 1,35' },
  { value: 1.3, label: 'Insuficiência renal aguda' },
  { value: 1.325, label: 'Infecção grave', range: '1,3 a 1,35' },
  { value: 1.35, label: 'Peritonite', range: '1,2 a 1,5' },
  { value: 1.35, label: 'PO cirurgia cardíaca', range: '1,2 a 1,5' },
  { value: 1.4, label: 'Insuficiência cardíaca', range: '1,3 a 1,5' },
  { value: 1.425, label: 'Doença cardiopulmonar com cirurgia', range: '1,3 a 1,55' },
  { value: 1.425, label: 'Insuficiência hepática', range: '1,3 a 1,55' },
  { value: 1.5, label: 'Desnutrição grave' },
  { value: 1.5, label: 'Multitrauma (reabilitação)' },
  { value: 1.6, label: 'Multitrauma + sepse' },
  { value: 1.7, label: 'Queimadura 30 a 50%' },
  { value: 1.8, label: 'Queimadura 50 a 70%' },
  { value: 2.0, label: 'Queimadura 70 a 90%' },
]
