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

export type CircumferenceSite = 'cintura' | 'quadril' | 'abdomen' | 'braco' | 'panturrilha' | 'pescoco'

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
}

export const DOBRA_PROTOCOLS: Record<DobraProtocol, ProtocolMeta> = {
  durnin_womersley: {
    slug: 'durnin_womersley',
    label: 'Durnin & Womersley (1974)',
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
    sites: {
      M: ['peitoral', 'abdominal', 'coxa'],
      F: ['triceps', 'suprailiaca', 'coxa'],
    },
    ageMin: 18,
  },
  jp7: {
    slug: 'jp7',
    label: 'Jackson-Pollock-Ward 7 dobras (1980)',
    sites: {
      M: ['triceps', 'peitoral', 'axilar_media', 'subescapular', 'abdominal', 'suprailiaca', 'coxa'],
      F: ['triceps', 'peitoral', 'axilar_media', 'subescapular', 'abdominal', 'suprailiaca', 'coxa'],
    },
    ageMin: 18,
  },
  petroski: {
    slug: 'petroski',
    label: 'Petroski (1995)',
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
}

export const TMB_EQUATIONS: Record<TmbEquation, TmbMeta> = {
  harris_benedict_1919: { slug: 'harris_benedict_1919', label: 'Harris-Benedict (1919)', usesHeight: true },
  harris_benedict_1984: { slug: 'harris_benedict_1984', label: 'Harris-Benedict (1984)', usesHeight: true },
  mifflin: { slug: 'mifflin', label: 'Mifflin-St Jeor (1990)', usesHeight: true },
  fao_who_1985: { slug: 'fao_who_1985', label: 'FAO/OMS (1985)' },
  fao_who_2004: { slug: 'fao_who_2004', label: 'FAO/WHO (2004)' },
  schofield: { slug: 'schofield', label: 'Schofield (1985)', usesHeight: true },
  henry_rees: { slug: 'henry_rees', label: 'Henry-Rees (1991)' },
  cunningham: { slug: 'cunningham', label: 'Cunningham (1980)', usesLeanMass: true },
  tinsley_peso: { slug: 'tinsley_peso', label: 'Tinsley — por peso (2018)' },
  tinsley_mlg: { slug: 'tinsley_mlg', label: 'Tinsley — por massa magra (2018)', usesLeanMass: true },
  katch_mcardle: { slug: 'katch_mcardle', label: 'Katch-McArdle (1996)', usesLeanMass: true },
  eer_iom_2005: { slug: 'eer_iom_2005', label: 'EER/IOM (2005)', usesHeight: true, eer: 'pa' },
  eer_2023: { slug: 'eer_2023', label: 'EER (2023)', usesHeight: true, eer: 'category' },
  eer_gestante: { slug: 'eer_gestante', label: 'EER Gestante (2023)', usesHeight: true, eer: 'category', femaleOnly: true },
  eer_lactante_0_6: { slug: 'eer_lactante_0_6', label: 'EER Lactante 0–6 meses (2023)', usesHeight: true, eer: 'category', femaleOnly: true },
  eer_lactante_7_12: { slug: 'eer_lactante_7_12', label: 'EER Lactante 7–12 meses (2023)', usesHeight: true, eer: 'category', femaleOnly: true },
}

/** Fator de atividade (PAL) clássico — multiplicador do TMB para equações não-EER. */
export const ACTIVITY_FACTORS: { value: number; label: string }[] = [
  { value: 1.2, label: 'Sedentário' },
  { value: 1.375, label: 'Leve' },
  { value: 1.55, label: 'Moderada' },
  { value: 1.725, label: 'Intensa' },
  { value: 1.9, label: 'Muito intensa' },
]

/** Fator de injúria/estresse (FI médio) — Long. */
export const INJURY_FACTORS: { value: number; label: string }[] = [
  { value: 1.0, label: 'Paciente não complicado' },
  { value: 1.05, label: 'Cirurgia eletiva' },
  { value: 1.1, label: 'Pós-operatório' },
  { value: 1.2, label: 'Fratura / Pequena cirurgia' },
  { value: 1.25, label: 'PO cirurgia geral / Queimadura até 20%' },
  { value: 1.275, label: 'Câncer / Fraturas múltiplas' },
  { value: 1.3, label: 'Insuficiência renal aguda' },
  { value: 1.325, label: 'Infecção grave' },
  { value: 1.35, label: 'Peritonite / Sepse leve / Transplante hepático' },
  { value: 1.4, label: 'Insuficiência cardíaca' },
  { value: 1.425, label: 'Insuficiência hepática / Cardiopulmonar c/ cirurgia' },
  { value: 1.45, label: 'Sepse' },
  { value: 1.5, label: 'Desnutrição grave / Multitrauma' },
  { value: 1.6, label: 'Multitrauma + sepse' },
  { value: 1.7, label: 'Queimadura 30–50%' },
  { value: 1.8, label: 'Queimadura 50–70%' },
  { value: 2.0, label: 'Queimadura 70–90%' },
]
