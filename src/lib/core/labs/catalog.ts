/**
 * Feature 050 — catálogo canônico de exames laboratoriais.
 *
 * Fonte: aba `BD_Exames` de `nutri-doc/Evonut.xlsm` (319 linhas). Entram aqui
 * apenas os analitos QUANTITATIVOS — os que têm unidade e ao menos um limite de
 * referência. Ficam de fora os ~200 exames qualitativos (cor da urina,
 * parasitológico, sorologias reagente/não-reagente), que não têm valor numérico
 * a classificar, e os 22 pseudo-exames do grupo "Exames Completos", que são
 * atalhos de painel de PEDIDO, não analitos.
 *
 * Este catálogo é a fonte da verdade de "o que é exame laboratorial e em que
 * painel aparece". O banco (`patient_metric_types`) é a fonte da verdade de
 * "existe, tem unidade e faixa plausível". Os dois são mantidos em sincronia
 * pela migration 0184.
 *
 * ATENÇÃO às chaves: os exames já semeados na migration 0113 mantêm a chave
 * LEGADA (`glicemia_jejum`, `hba1c`, `hdl`, `ldl`, `triglicerides`) porque as
 * linhas globais de `patient_metric_types` são append-only e já têm séries
 * históricas. Analitos novos usam o prefixo `lab_`.
 *
 * Puro/sem I/O — usado no importador, no servidor e no cliente.
 *
 * GERADO a partir da planilha; reveja à mão se a fonte mudar.
 */

export interface LabAnalyteDef {
  /** `metric_type` em `patient_metric_types`. */
  key: string
  label: string
  unit: string
  /** Painel de exibição (grupo da planilha). */
  group: string
  /** Nomes alternativos na fonte — usados pelo importador de faixas. */
  aliases?: readonly string[]
  displayOrder: number
}

export const LAB_ANALYTES: readonly LabAnalyteDef[] = [
  { key: 'glicemia_jejum', label: 'Glicemia de jejum', unit: 'mg/dL', group: 'Metabolismo da Glicose', displayOrder: 10, aliases: ['Glicose em jejum'] },
  { key: 'hba1c', label: 'Hemoglobina glicada (HbA1c)', unit: '%', group: 'Metabolismo da Glicose', displayOrder: 20, aliases: ['HbA1C'] },
  { key: 'lab_homa_beta', label: 'HOMA-beta', unit: 'mmol/L', group: 'Metabolismo da Glicose', displayOrder: 30, aliases: ['HOMA beta'] },
  { key: 'lab_insulina', label: 'Insulina', unit: 'mUI/L', group: 'Metabolismo da Glicose', displayOrder: 40 },
  { key: 'lab_proinsulina', label: 'Pró-insulina', unit: 'pmol/L', group: 'Metabolismo da Glicose', displayOrder: 50 },
  { key: 'lab_apo_a1', label: 'Apolipoproteína A-I', unit: 'mg/dL', group: 'Perfil Lipídico', displayOrder: 60, aliases: ['Apolipoproteína A-I (apo A-I)', 'Apoliproteína A'] },
  { key: 'lab_apo_b', label: 'Apolipoproteína B', unit: 'mg/dL', group: 'Perfil Lipídico', displayOrder: 70, aliases: ['Apolipoproteína b', 'Apolipoproteína B (apo B)'] },
  { key: 'ldl', label: 'LDL', unit: 'mg/dL', group: 'Perfil Lipídico', displayOrder: 80, aliases: ['Lipoproteína de baixa densidade (LDL)'] },
  { key: 'lab_adiponectina', label: 'Adiponectina', unit: 'mcg/mL', group: 'Função Cardíaca', displayOrder: 90 },
  { key: 'lab_coenzima_q10', label: 'Coenzima Q10', unit: 'mg/L', group: 'Função Cardíaca', displayOrder: 100 },
  { key: 'hdl', label: 'HDL', unit: 'mg/dL', group: 'Função Cardíaca', displayOrder: 110 },
  { key: 'lab_homocisteina', label: 'Homocisteína', unit: 'µmol/L', group: 'Função Cardíaca', displayOrder: 120 },
  { key: 'lab_ldl_oxidado', label: 'LDL oxidado', unit: 'mcg/mL', group: 'Função Cardíaca', displayOrder: 130 },
  { key: 'lab_lp_pla2', label: 'Lp-PLA2', unit: 'ng/mL', group: 'Função Cardíaca', displayOrder: 140 },
  { key: 'lab_lipoproteina_a', label: 'Lp(a)', unit: 'mg/dL', group: 'Função Cardíaca', displayOrder: 150 },
  { key: 'lab_mieloperoxidase', label: 'Mieloperoxidase', unit: 'pmol/L', group: 'Função Cardíaca', displayOrder: 160 },
  { key: 'lab_pcr_us', label: 'PCR ultrassensível', unit: 'mg/dL', group: 'Função Cardíaca', displayOrder: 170, aliases: ['Proteína C-reativa ultrassensível (PC-R)'] },
  { key: 'triglicerides', label: 'Triglicérides', unit: 'mg/dL', group: 'Função Cardíaca', displayOrder: 180 },
  { key: 'lab_basofilos', label: 'Basófilos', unit: '%', group: 'Hemograma', displayOrder: 190 },
  { key: 'lab_chcm', label: 'CHCM', unit: 'g/dL', group: 'Hemograma', displayOrder: 200, aliases: ['Concentração de HCM (CHCM)'] },
  { key: 'lab_eosinofilos', label: 'Eosinófilos', unit: '%', group: 'Hemograma', displayOrder: 210 },
  { key: 'lab_fibrinogenio', label: 'Fibrinogênio', unit: 'mg/dL', group: 'Hemograma', displayOrder: 220 },
  { key: 'lab_hcm', label: 'HCM', unit: 'pg', group: 'Hemograma', displayOrder: 230, aliases: ['Hemoglobina corpuscular média (HCM)'] },
  { key: 'lab_hemacias', label: 'Hemácias (eritrócitos)', unit: '10⁶/mm³', group: 'Hemograma', displayOrder: 240 },
  { key: 'lab_hematocrito', label: 'Hematócrito', unit: '%', group: 'Hemograma', displayOrder: 250 },
  { key: 'lab_hemoglobina', label: 'Hemoglobina', unit: 'g/dL', group: 'Hemograma', displayOrder: 260 },
  { key: 'lab_holotranscobalamina', label: 'Holotranscobalamina', unit: 'pmol/L', group: 'Hemograma', displayOrder: 270 },
  { key: 'lab_leucocitos', label: 'Leucócitos (contagem diferencial)', unit: 'mm³', group: 'Hemograma', displayOrder: 280, aliases: ['Contagem diferencial de leucócitos'] },
  { key: 'lab_linfocitos', label: 'Linfócitos', unit: '%', group: 'Hemograma', displayOrder: 290 },
  { key: 'lab_monocitos', label: 'Monócitos', unit: '%', group: 'Hemograma', displayOrder: 300 },
  { key: 'lab_neutrofilos', label: 'Neutrófilos', unit: '%', group: 'Hemograma', displayOrder: 310 },
  { key: 'lab_plaquetas', label: 'Plaquetas', unit: 'mm³', group: 'Hemograma', displayOrder: 320 },
  { key: 'lab_rdw', label: 'RDW', unit: '%', group: 'Hemograma', displayOrder: 330, aliases: ['RDW (índice de anisocitose)'] },
  { key: 'lab_vcm', label: 'VCM', unit: 'fL', group: 'Hemograma', displayOrder: 340, aliases: ['Volume corpuscular médio (VCM)'] },
  { key: 'lab_vsg', label: 'VSG', unit: 'mm', group: 'Hemograma', displayOrder: 350 },
  { key: 'lab_ferritina', label: 'Ferritina', unit: 'mcg/L', group: 'Metabolismo do Ferro', displayOrder: 360 },
  { key: 'lab_saturacao_transferrina', label: 'Saturação da transferrina', unit: '%', group: 'Metabolismo do Ferro', displayOrder: 370, aliases: ['Índice de saturação da transferrina (IST)'] },
  { key: 'lab_bilirrubina_direta', label: 'Bilirrubina direta', unit: 'mg/dL', group: 'Função Hepática', displayOrder: 380 },
  { key: 'lab_bilirrubina_indireta', label: 'Bilirrubina indireta', unit: 'mg/dL', group: 'Função Hepática', displayOrder: 390 },
  { key: 'lab_bilirrubina_total', label: 'Bilirrubina total', unit: 'mg/dL', group: 'Função Hepática', displayOrder: 400 },
  { key: 'lab_fosfatase_alcalina', label: 'Fosfatase alcalina', unit: 'U/L', group: 'Função Hepática', displayOrder: 410, aliases: ['Fosfatase alcalina (FA)'] },
  { key: 'lab_ggt', label: 'GGT', unit: 'U/L', group: 'Função Hepática', displayOrder: 420, aliases: ['Gamaglutamiltransferase (GGT)'] },
  { key: 'lab_tgo', label: 'TGO (AST)', unit: 'U/L', group: 'Função Hepática', displayOrder: 430, aliases: ['Transaminase glutâmico oxaloacética (TGO)'] },
  { key: 'lab_tgp', label: 'TGP (ALT)', unit: 'U/L', group: 'Função Hepática', displayOrder: 440, aliases: ['Transaminase glutâmico pirúvica (TGP)'] },
  { key: 'lab_acido_urico', label: 'Ácido úrico', unit: 'mg/dL', group: 'Função Renal', displayOrder: 450 },
  { key: 'lab_calcio_ionico', label: 'Cálcio iônico', unit: 'mg/dL', group: 'Função Renal', displayOrder: 460 },
  { key: 'lab_ureia', label: 'Ureia', unit: 'mg/dL', group: 'Função Renal', displayOrder: 470 },
  { key: 'lab_iodo_na_urina', label: 'Iodo na urina', unit: 'mcg/L', group: 'Função Tireoidiana', displayOrder: 480 },
  { key: 'lab_iodo_salivar', label: 'Iodo salivar', unit: 'mcg/L', group: 'Função Tireoidiana', displayOrder: 490 },
  { key: 'lab_t3_livre', label: 'T3 livre', unit: 'pg/mL', group: 'Função Tireoidiana', displayOrder: 500, aliases: ['T3 Livre'] },
  { key: 'lab_t3_reverso', label: 'T3 reverso', unit: 'ng/mL', group: 'Função Tireoidiana', displayOrder: 510 },
  { key: 'lab_t3_total', label: 'T3 total', unit: 'ng/dL', group: 'Função Tireoidiana', displayOrder: 520, aliases: ['Tri-iodotironina (T3 total)'] },
  { key: 'lab_t4_livre', label: 'T4 livre (tiroxina livre)', unit: 'ng/dL', group: 'Função Tireoidiana', displayOrder: 530, aliases: ['T4 livre', 'Tiroxina livre (T4 livre)'] },
  { key: 'lab_tireoglobulina', label: 'Tireoglobulina', unit: 'ng/mL', group: 'Função Tireoidiana', displayOrder: 540 },
  { key: 'lab_tsh', label: 'TSH', unit: 'mUI/L', group: 'Função Tireoidiana', displayOrder: 550, aliases: ['Hormônio estimulante da tireóide (TSH)'] },
  { key: 'lab_cortisol', label: 'Cortisol', unit: 'nmol/L', group: 'Função Hormonal', displayOrder: 560 },
  { key: 'lab_dht', label: 'DHT', unit: 'pg/mL', group: 'Função Hormonal', displayOrder: 570 },
  { key: 'lab_estradiol', label: 'Estradiol', unit: 'ng/dL', group: 'Função Hormonal', displayOrder: 580 },
  { key: 'lab_fsh', label: 'FSH', unit: 'mIU/mL', group: 'Função Hormonal', displayOrder: 590 },
  { key: 'lab_lh', label: 'LH', unit: 'mIU/mL', group: 'Função Hormonal', displayOrder: 600 },
  { key: 'lab_progesterona', label: 'Progesterona', unit: 'ng/mL', group: 'Função Hormonal', displayOrder: 610 },
  { key: 'lab_sdhea', label: 'SDHEA', unit: 'mcg/dL', group: 'Função Hormonal', displayOrder: 620 },
  { key: 'lab_shbg', label: 'SHBG', unit: 'nmol/L', group: 'Função Hormonal', displayOrder: 630 },
  { key: 'lab_t4_total', label: 'T4 total', unit: 'mcg/dL', group: 'Função Hormonal', displayOrder: 640, aliases: ['Tiroxina total (T4 total)'] },
  { key: 'lab_testosterona_total', label: 'Testosterona total', unit: 'ng/dL', group: 'Função Hormonal', displayOrder: 650, aliases: ['Testosterona'] },
  { key: 'lab_calcio_total', label: 'Cálcio total', unit: 'mg/dL', group: 'Metabolismo Ósseo', displayOrder: 660 },
  { key: 'lab_cobre', label: 'Cobre', unit: 'mcg/dL', group: 'Metabolismo Ósseo', displayOrder: 670 },
  { key: 'lab_fosforo', label: 'Fósforo', unit: 'mg/dL', group: 'Metabolismo Ósseo', displayOrder: 680 },
  { key: 'lab_pth', label: 'Paratormônio (PTH)', unit: 'pg/mL', group: 'Metabolismo Ósseo', displayOrder: 690 },
  { key: 'lab_vitamina_d', label: 'Vitamina D (25-OH)', unit: 'ng/mL', group: 'Metabolismo Ósseo', displayOrder: 700, aliases: ['25-hidroxi D3'] },
  { key: 'lab_magnesio', label: 'Magnésio', unit: 'mg/dL', group: 'Equilíbrio Hidreletrolítico', displayOrder: 710 },
  { key: 'lab_manganes', label: 'Manganês', unit: 'mcg/dL', group: 'Equilíbrio Hidreletrolítico', displayOrder: 720 },
  { key: 'lab_potassio', label: 'Potássio', unit: 'mEq/L', group: 'Equilíbrio Hidreletrolítico', displayOrder: 730 },
  { key: 'lab_sodio', label: 'Sódio', unit: 'mEq/L', group: 'Equilíbrio Hidreletrolítico', displayOrder: 740 },
  { key: 'lab_zinco', label: 'Zinco', unit: 'mg/L', group: 'Equilíbrio Hidreletrolítico', displayOrder: 750 },
  { key: 'lab_acido_folico', label: 'Ácido fólico', unit: 'ng/mL', group: 'Anemia Macrocíticas', displayOrder: 760 },
  { key: 'lab_acido_metilmalonico', label: 'Ácido metilmalônico', unit: 'mmol/L', group: 'Anemia Macrocíticas', displayOrder: 770 },
  { key: 'lab_vitamina_b12', label: 'Vitamina B12', unit: 'pg/mL', group: 'Anemia Macrocíticas', displayOrder: 780 },
  { key: 'lab_betacaroteno', label: 'Betacaroteno', unit: 'mcg/dL', group: 'Marcadores de Desnutrição', displayOrder: 790 },
  { key: 'lab_selenio', label: 'Selênio', unit: 'mcg/L', group: 'Marcadores de Desnutrição', displayOrder: 800 },
  { key: 'lab_vitamina_a', label: 'Vitamina A (retinol)', unit: 'mg/L', group: 'Marcadores de Desnutrição', displayOrder: 810 },
  { key: 'lab_vitamina_c', label: 'Vitamina C', unit: 'mg/dL', group: 'Marcadores de Desnutrição', displayOrder: 820 },
  { key: 'lab_vitamina_e', label: 'Vitamina E', unit: 'mg/L', group: 'Marcadores de Desnutrição', displayOrder: 830 },
  { key: 'lab_calcio_urinario', label: 'Cálcio urinário', unit: 'mg/24h', group: 'Exame de Urina', displayOrder: 840 },
  { key: 'lab_creatinina_urinaria', label: 'Creatinina urinária', unit: 'mg/24h', group: 'Exame de Urina', displayOrder: 850, aliases: ['Creatinina na urina'] },
]

const BY_KEY = new Map(LAB_ANALYTES.map((a) => [a.key, a]))

export function labAnalyte(key: string): LabAnalyteDef | undefined {
  return BY_KEY.get(key)
}

export function isLabAnalyte(key: string): boolean {
  return BY_KEY.has(key)
}

/** Normalização de nome usada para casar a planilha com o catálogo. */
export function normalizeAnalyteName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** nome normalizado (label + aliases) -> chave do analito. */
export const ANALYTE_BY_NAME: ReadonlyMap<string, string> = new Map(
  LAB_ANALYTES.flatMap((a) =>
    [a.label, ...(a.aliases ?? [])].map((n) => [normalizeAnalyteName(n), a.key] as const),
  ),
)

/**
 * `Cod Exame` da planilha -> chave, para os homônimos que o nome não distingue.
 * Na fonte, "Cálcio" (cod 45, 9,3–10,2 mg/dL) e "Cálcio (total e iônico)"
 * (cod 46, 4,55–5,12 mg/dL) são o cálcio TOTAL e o IÔNICO — exames diferentes
 * com nomes que normalizam para a mesma string. O importador resolve por este
 * mapa antes de tentar por nome.
 */
export const ANALYTE_BY_SOURCE_COD: ReadonlyMap<number, string> = new Map([
  [45, 'lab_calcio_total'],
  [46, 'lab_calcio_ionico'],
])

/** Painéis na ordem de exibição. */
export const LAB_GROUPS: readonly string[] = [
  ...new Set(LAB_ANALYTES.map((a) => a.group)),
]
