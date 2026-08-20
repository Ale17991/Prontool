/**
 * Feature 054 — gera uma amostra de cada impresso, em arquivo, para conferência
 * visual (T041) e para a conferência campo a campo com a nutricionista (T042).
 *
 * Existe porque o artefato desta feature É visual: nenhum teste diz se o número
 * caiu no lugar certo da folha, se a coluna coube ou se a tarja aparece. Rodar
 * o app inteiro e clicar em sete botões para descobrir isso é caro demais para
 * se repetir a cada ajuste de layout — daqui sai o PDF em segundos.
 *
 * Os dados são fictícios e ficam AQUI, no script: o objetivo é exercitar o
 * layout (nome longo, item sem quantidade, exame sem faixa, pergunta em branco),
 * não refletir um paciente real.
 *
 *   pnpm tsx scripts/preview-printouts.ts --out <pasta>
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { renderAnamnesisPdf } from '@/lib/core/anamnesis/export-pdf'
import { renderCareNotesPdf } from '@/lib/core/care-notes/notes-pdf'
import { classifyLabResults, type LabRange } from '@/lib/core/labs/classify'
import type { ClinicProfile } from '@/lib/core/clinic-profile/types'
import type { GrowthCurve } from '@/lib/core/growth/read'
import type { PercentileRow } from '@/lib/core/growth/classify'
import type { AdequacyResult } from '@/lib/core/nutrition/adequacy'
import type { AssessmentForPrint } from '@/lib/core/nutrition/assessments/for-printout'
import type { DietPlanView } from '@/lib/core/nutrition/diet/plan'
import type { RecallView } from '@/lib/core/nutrition/recall/plan'
import { renderAssessmentPdf } from '@/lib/core/nutrition/printouts/assessment-pdf'
import { renderGrowthPdf } from '@/lib/core/nutrition/printouts/growth-pdf'
import { renderLabsPdf } from '@/lib/core/nutrition/printouts/labs-pdf'
import { renderPlanPdf } from '@/lib/core/nutrition/printouts/plan-pdf'
import { renderRecallPdf } from '@/lib/core/nutrition/printouts/recall-pdf'
import type { PatientIdentity } from '@/lib/core/printouts/patient-identity'

const EMITIDO_EM = '2026-08-05'
const PROFISSIONAL = 'ana.ferreira@nutricaoviva.com.br'

const CLINICA: ClinicProfile = {
  tenantId: '00000000-0000-0000-0000-000000000000',
  displayName: 'Nutrição Viva',
  logo: null,
  corporateName: 'Nutrição Viva Serviços em Saúde LTDA',
  cnpj: '12345678000190',
  phone: '(11) 3456-7890',
  email: 'contato@nutricaoviva.com.br',
  address: {
    cep: '01310100',
    street: 'Avenida Paulista',
    number: '1000',
    complement: 'Conjunto 142',
    neighborhood: 'Bela Vista',
    city: 'São Paulo',
    uf: 'SP',
  },
  techResponsible: { name: 'Ana Ferreira', council: 'CRN', registration: '3-12345' },
  publicBookingSlug: null,
  publicBookingEnabled: false,
  calendarSlotIntervalMinutes: 60,
  calendarOpenTime: '07:00',
  calendarCloseTime: '22:00',
  surgicalScanRequired: false,
  updatedAt: '2026-08-01T12:00:00Z',
}

// Nome comprido de propósito: é onde o cabeçalho e o rodapé estouram.
const ADULTA: PatientIdentity = {
  name: 'Mariana Alves de Souza Rodrigues',
  lines: [
    { key: 'nascimento', label: 'Nascimento', value: '10/05/1990' },
    { key: 'idade', label: 'Idade', value: '36 anos' },
  ],
}

const CRIANCA: PatientIdentity = {
  name: 'Pedro Henrique Lima',
  lines: [
    { key: 'nascimento', label: 'Nascimento', value: '14/02/2023' },
    { key: 'idade', label: 'Idade', value: '3 anos' },
  ],
}

const nut = (
  energyKcal: number,
  proteinG: number,
  carbG: number,
  fatG: number,
  fiberG: number,
) => ({
  energyKcal,
  proteinG,
  carbG,
  fatG,
  fiberG,
})

// ---------------------------------------------------------------------------
// 1. Plano alimentar — com grupo de substituição e uma refeição sem horário.
// ---------------------------------------------------------------------------

const PLANO: DietPlanView = {
  id: 'plan-1',
  title: 'Plano alimentar — agosto/2026',
  status: 'prescrito',
  target: {
    kcal: 1800,
    macros: { protG: 108, carbG: 202, fatG: 60 },
    assessmentId: 'a3',
    assessedAt: '2026-08-01',
  },
  delta: null,
  meals: [
    {
      id: 'm1',
      name: 'Café da manhã',
      timeLabel: '07:30',
      position: 0,
      targetPct: 25,
      totals: nut(450, 22, 55, 15, 6),
      items: [
        {
          id: 'i1',
          foodId: 'f1',
          name: 'Pão francês integral',
          grams: 50,
          measureLabel: 'unidade',
          measureQty: 1,
          equivalenceListId: null,
          isGroup: false,
          groupOptions: null,
          groupReferenceKcal: null,
          nutrients: nut(140, 5, 27, 1.5, 2.4),
        },
        {
          id: 'i2',
          foodId: null,
          name: 'Fruta da estação',
          grams: null,
          measureLabel: null,
          measureQty: null,
          equivalenceListId: 'eq1',
          isGroup: true,
          groupReferenceKcal: 70,
          groupOptions: [
            { foodId: 'f9', name: 'Banana prata', grams: 86 },
            { foodId: 'f10', name: 'Maçã com casca', grams: 130 },
            { foodId: 'f11', name: 'Mamão papaia', grams: 160 },
          ],
          nutrients: nut(70, 0.8, 18, 0.2, 2),
        },
      ],
    },
    {
      id: 'm2',
      name: 'Almoço',
      timeLabel: '12:30',
      position: 1,
      targetPct: 35,
      totals: nut(630, 42, 70, 18, 9),
      items: [
        {
          id: 'i3',
          foodId: 'f2',
          name: 'Arroz integral cozido',
          grams: 150,
          measureLabel: 'colher de servir',
          measureQty: 3,
          equivalenceListId: null,
          isGroup: false,
          groupOptions: null,
          groupReferenceKcal: null,
          nutrients: nut(186, 3.9, 38.7, 1.4, 4),
        },
        {
          id: 'i4',
          foodId: 'f3',
          name: 'Feijão carioca cozido',
          grams: 80,
          measureLabel: 'concha média',
          measureQty: 1,
          equivalenceListId: null,
          isGroup: false,
          groupOptions: null,
          groupReferenceKcal: null,
          nutrients: nut(61, 3.8, 10.9, 0.4, 6.8),
        },
        {
          id: 'i5',
          foodId: 'f4',
          name: 'Filé de frango grelhado sem pele',
          grams: 120,
          measureLabel: 'filé médio',
          measureQty: 1,
          equivalenceListId: null,
          isGroup: false,
          groupOptions: null,
          groupReferenceKcal: null,
          nutrients: nut(198, 37.2, 0, 4.8, 0),
        },
      ],
    },
    {
      id: 'm3',
      name: 'Lanche da tarde',
      timeLabel: null,
      position: 2,
      targetPct: null,
      totals: nut(220, 18, 20, 6, 2),
      items: [
        {
          id: 'i6',
          foodId: 'f5',
          name: 'Iogurte natural desnatado',
          grams: 170,
          measureLabel: 'pote',
          measureQty: 1,
          equivalenceListId: null,
          isGroup: false,
          groupOptions: null,
          groupReferenceKcal: null,
          nutrients: nut(100, 10, 12, 0.5, 0),
        },
      ],
    },
    {
      id: 'm4',
      name: 'Jantar',
      timeLabel: '19:30',
      position: 3,
      targetPct: 25,
      totals: nut(500, 30, 52, 16, 7),
      items: [
        {
          id: 'i7',
          foodId: 'f6',
          name: 'Sopa de legumes com carne magra',
          grams: 350,
          measureLabel: 'prato fundo',
          measureQty: 1,
          equivalenceListId: null,
          isGroup: false,
          groupOptions: null,
          groupReferenceKcal: null,
          nutrients: nut(280, 22, 28, 8, 5),
        },
      ],
    },
  ],
  totals: nut(1800, 112, 197, 55, 24),
}

// ---------------------------------------------------------------------------
// 2. Evolução — três avaliações, a última por bioimpedância (método diferente).
// ---------------------------------------------------------------------------

const AVALIACOES: AssessmentForPrint[] = [
  {
    id: 'a1',
    assessedAt: '2026-02-10',
    weightKg: 78.4,
    heightCm: 165,
    dobraProtocol: 'durnin_womersley',
    fatPct: 33.2,
    fatMassKg: 26,
    leanMassKg: 52.4,
    imc: 28.8,
    imcClass: 'Sobrepeso',
    waistHipRatio: 0.86,
    waistHipClass: 'Risco moderado',
    tmbEquation: 'mifflin',
    tmbKcal: 1452,
    getKcal: 2250,
    targetKcal: 1900,
    circumferences: { cintura: 92, quadril: 107 },
  },
  {
    id: 'a2',
    assessedAt: '2026-05-12',
    weightKg: 74.1,
    heightCm: 165,
    dobraProtocol: 'durnin_womersley',
    fatPct: 30.4,
    fatMassKg: 22.5,
    leanMassKg: 51.6,
    imc: 27.2,
    imcClass: 'Sobrepeso',
    waistHipRatio: 0.83,
    waistHipClass: 'Risco moderado',
    tmbEquation: 'mifflin',
    tmbKcal: 1408,
    getKcal: 2183,
    targetKcal: 1850,
    circumferences: { cintura: 87, quadril: 105 },
  },
  {
    id: 'a3',
    assessedAt: '2026-08-01',
    weightKg: 71.3,
    heightCm: 165,
    dobraProtocol: 'bioimpedancia',
    fatPct: 28.1,
    fatMassKg: 20,
    leanMassKg: 51.3,
    imc: 26.2,
    imcClass: 'Sobrepeso',
    waistHipRatio: 0.81,
    waistHipClass: 'Baixo risco',
    tmbEquation: 'mifflin',
    tmbKcal: 1380,
    getKcal: 2139,
    targetKcal: 1800,
    circumferences: { cintura: 84, quadril: 104 },
  },
]

// ---------------------------------------------------------------------------
// 3. Orientações — uma curta e uma longa, que atravessa página.
// ---------------------------------------------------------------------------

const ORIENTACOES = [
  {
    id: 'n1',
    createdAt: '2026-08-04T20:15:00Z',
    body:
      'Manter caminhada de 30 minutos, cinco vezes por semana, em ritmo confortável.\n' +
      'Beber pelo menos 2 litros de água ao longo do dia — a garrafa na mesa de trabalho ajuda mais que lembrete no celular.\n' +
      'Retornar em 30 dias trazendo os exames solicitados.',
  },
  {
    id: 'n2',
    createdAt: '2026-07-18T13:40:00Z',
    body:
      'GUIA DE BAIXO FODMAP — FASE DE ELIMINAÇÃO (4 semanas)\n\n' +
      'Durante esta fase, evite os alimentos abaixo. Não é uma dieta definitiva: o objetivo é ' +
      'identificar quais grupos causam sintoma em você, e depois reintroduzir um a um.\n\n' +
      'EVITAR — Frutas: maçã, pera, manga, melancia, cereja, ameixa, damasco, frutas em calda.\n' +
      'EVITAR — Vegetais: alho, cebola, couve-flor, cogumelo, ervilha, aspargo, alcachofra.\n' +
      'EVITAR — Laticínios: leite de vaca, iogurte comum, sorvete, queijos frescos (ricota, cottage).\n' +
      'EVITAR — Cereais: trigo, centeio e cevada em grandes quantidades (pão, macarrão, biscoito).\n' +
      'EVITAR — Leguminosas: feijão, grão-de-bico, lentilha, soja em grão.\n' +
      'EVITAR — Adoçantes: sorbitol, manitol, xilitol, mel, xarope de milho.\n\n' +
      'PODE — Frutas: banana, laranja, morango, uva, abacaxi, kiwi, mamão.\n' +
      'PODE — Vegetais: cenoura, abobrinha, berinjela, tomate, pepino, batata, espinafre, alface.\n' +
      'PODE — Laticínios: leite sem lactose, queijos curados (parmesão, muçarela), iogurte sem lactose.\n' +
      'PODE — Cereais: arroz, aveia, quinoa, milho, tapioca, pão sem glúten.\n' +
      'PODE — Proteínas: carnes, aves, peixes, ovos e tofu firme.\n\n' +
      'SUBSTITUIÇÕES QUE FUNCIONAM NO DIA A DIA\n' +
      'No lugar de alho e cebola, use a parte verde da cebolinha, cebolinha francesa ou óleo ' +
      'aromatizado com alho (o composto que causa sintoma não passa para o óleo).\n' +
      'No lugar do leite comum, leite sem lactose ou bebida de arroz.\n' +
      'No lugar do trigo no lanche, tapioca, pão sem glúten ou biscoito de arroz.\n\n' +
      'IMPORTANTE: passadas as 4 semanas, marque retorno. A reintrodução é parte do tratamento e ' +
      'não deve ser feita sozinha — ficar em baixo FODMAP por tempo indeterminado empobrece a ' +
      'microbiota e não é o objetivo.',
  },
]

// ---------------------------------------------------------------------------
// 4. Anamnese — com perguntas em branco de propósito.
// ---------------------------------------------------------------------------

const ANAMNESE_CAMPOS = [
  { id: 'default_nome', label: 'Nome completo', is_default: true },
  { id: 'q_queixa', label: 'Queixa principal' },
  { id: 'q_objetivo', label: 'Objetivo com o acompanhamento' },
  { id: 'q_habito_intestinal', label: 'Hábito intestinal' },
  { id: 'q_agua', label: 'Consumo de água por dia' },
  { id: 'q_sono', label: 'Qualidade do sono' },
  { id: 'q_atividade', label: 'Atividade física (tipo e frequência)' },
  { id: 'q_alergia_alimentar', label: 'Alergia ou intolerância alimentar' },
  { id: 'q_medicamentos', label: 'Medicamentos em uso' },
  { id: 'q_suplementos', label: 'Suplementos em uso' },
  { id: 'q_restricoes', label: 'Restrições alimentares' },
  { id: 'q_historico_familiar', label: 'Histórico familiar de doença crônica' },
  { id: 'q_alcool', label: 'Consumo de álcool' },
]

const ANAMNESE_RESPOSTAS: Record<string, unknown> = {
  default_nome: ADULTA.name,
  q_queixa: 'Ganho de peso progressivo nos últimos três anos, com piora após mudança de emprego.',
  q_objetivo: 'Perder peso de forma sustentável e melhorar a disposição no fim do dia.',
  q_habito_intestinal: 'Irregular — evacua a cada dois ou três dias, com esforço.',
  q_agua: 'Cerca de 1 litro',
  q_atividade: 'Caminhada duas vezes por semana, 30 minutos.',
  q_alergia_alimentar: 'Intolerância à lactose (sintomas leves).',
  q_restricoes: ['Não come carne vermelha', 'Evita frituras'],
  q_alcool: false,
  // q_sono, q_medicamentos, q_suplementos e q_historico_familiar ficam em
  // branco: é o cenário de aceite da US3 — a pergunta continua na folha.
}

// ---------------------------------------------------------------------------
// 5. Recordatório — com um item sem quantidade informada.
// ---------------------------------------------------------------------------

const RECORDATORIO: RecallView = {
  id: 'r1',
  recallDate: '2026-08-03',
  notes: 'Dia de fim de semana; almoço fora de casa.',
  meals: [
    {
      name: 'Café da manhã',
      totals: nut(310, 12, 44, 9, 3),
      items: [
        {
          foodId: 'f1',
          name: 'Pão francês',
          grams: 50,
          measureLabel: 'unidade',
          measureQty: 1,
          nutrients: nut(150, 4.8, 29, 1.6, 1.2),
        },
        {
          foodId: 'f7',
          name: 'Café com leite integral',
          grams: 200,
          measureLabel: 'xícara grande',
          measureQty: 1,
          nutrients: nut(120, 6.4, 9.6, 6.6, 0),
        },
        {
          foodId: 'f8',
          name: 'Manteiga',
          grams: 8,
          measureLabel: 'ponta de faca',
          measureQty: 1,
          nutrients: nut(40, 0.1, 0, 4.5, 0),
        },
      ],
    },
    {
      name: 'Almoço',
      totals: nut(780, 38, 88, 28, 9),
      items: [
        {
          foodId: 'f2',
          name: 'Arroz branco cozido',
          grams: 200,
          measureLabel: 'escumadeira',
          measureQty: 2,
          nutrients: nut(256, 5, 56.2, 0.4, 1.6),
        },
        {
          foodId: 'f3',
          name: 'Feijão preto cozido',
          grams: 100,
          measureLabel: 'concha',
          measureQty: 1,
          nutrients: nut(77, 4.5, 14, 0.5, 8.4),
        },
        {
          foodId: 'f12',
          name: 'Bife acebolado',
          grams: 130,
          measureLabel: 'bife médio',
          measureQty: 1,
          nutrients: nut(287, 26, 2, 19, 0.4),
        },
        // Item sem quantidade: deve sair com travessão, e NÃO entrar como zero.
        {
          foodId: 'f13',
          name: 'Salada de folhas com azeite',
          grams: null,
          measureLabel: null,
          measureQty: null,
          nutrients: null,
        },
      ],
    },
    {
      name: 'Jantar',
      totals: nut(430, 24, 46, 16, 5),
      items: [
        {
          foodId: 'f6',
          name: 'Sopa de mandioquinha com frango',
          grams: 350,
          measureLabel: 'prato fundo',
          measureQty: 1,
          nutrients: nut(430, 24, 46, 16, 5),
        },
      ],
    },
  ],
  totals: nut(1520, 74, 178, 53, 17),
}

const ADEQUACAO: AdequacyResult = {
  deficits: 3,
  excesses: 1,
  items: [
    {
      nutrientKey: 'fibra',
      label: 'Fibra',
      unit: 'g',
      total: 17,
      dri: 25,
      pct: 68,
      class: 'abaixo',
    },
    {
      nutrientKey: 'calcio',
      label: 'Cálcio',
      unit: 'mg',
      total: 620,
      dri: 1000,
      pct: 62,
      class: 'abaixo',
    },
    {
      nutrientKey: 'ferro',
      label: 'Ferro',
      unit: 'mg',
      total: 14.2,
      dri: 18,
      pct: 79,
      class: 'abaixo',
    },
    {
      nutrientKey: 'vitamina_c',
      label: 'Vitamina C',
      unit: 'mg',
      total: 88,
      dri: 75,
      pct: 117,
      class: 'adequado',
    },
    {
      nutrientKey: 'sodio',
      label: 'Sódio',
      unit: 'mg',
      total: 3100,
      dri: 2300,
      pct: 135,
      class: 'acima',
    },
    {
      nutrientKey: 'zinco',
      label: 'Zinco',
      unit: 'mg',
      total: 9.1,
      dri: 8,
      pct: 114,
      class: 'adequado',
    },
  ],
}

// ---------------------------------------------------------------------------
// 6. Exames — inclui um analito SEM faixa cadastrada, de propósito.
// ---------------------------------------------------------------------------

const FAIXAS = new Map<string, LabRange>([
  ['glicemia_jejum', { refMin: 70, refMax: 99, unit: 'mg/dL', sourceLabel: null }],
  ['hba1c', { refMin: null, refMax: 5.7, unit: '%', sourceLabel: null }],
  ['ldl', { refMin: null, refMax: 130, unit: 'mg/dL', sourceLabel: null }],
  ['hdl', { refMin: 50, refMax: null, unit: 'mg/dL', sourceLabel: null }],
  ['triglicerides', { refMin: null, refMax: 150, unit: 'mg/dL', sourceLabel: null }],
])

const PAINEL = classifyLabResults(
  [
    { analyteKey: 'glicemia_jejum', value: 108, unit: 'mg/dL', measuredAt: '2026-07-28' },
    { analyteKey: 'hba1c', value: 5.9, unit: '%', measuredAt: '2026-07-28' },
    { analyteKey: 'ldl', value: 148, unit: 'mg/dL', measuredAt: '2026-07-28' },
    { analyteKey: 'hdl', value: 44, unit: 'mg/dL', measuredAt: '2026-07-28' },
    { analyteKey: 'triglicerides', value: 122, unit: 'mg/dL', measuredAt: '2026-07-28' },
    // Sem faixa na fonte: PRECISA sair sem situação, e não como "normal".
    { analyteKey: 'colesterol_total', value: 218, unit: 'mg/dL', measuredAt: '2026-07-28' },
  ],
  FAIXAS,
)

// ---------------------------------------------------------------------------
// 7. Crescimento — curvas de um menino de ~3 anos.
// ---------------------------------------------------------------------------

function bands(from: number, to: number, at: (m: number) => number): PercentileRow[] {
  const out: PercentileRow[] = []
  for (let m = from; m <= to; m++) {
    const p50 = at(m)
    out.push({
      ageMonths: m,
      p01: p50 * 0.7,
      p3: p50 * 0.79,
      p5: p50 * 0.82,
      p10: p50 * 0.86,
      p15: p50 * 0.89,
      p50,
      p85: p50 * 1.11,
      p97: p50 * 1.22,
      p999: p50 * 1.33,
    })
  }
  return out
}

const CURVAS: GrowthCurve[] = [
  {
    indicator: 'peso_idade',
    label: 'Peso para a idade',
    unit: 'kg',
    bands: bands(20, 44, (m) => 9.6 + m * 0.19),
    points: [
      {
        measuredAt: '2025-02-14',
        ageMonths: 24,
        value: 13.4,
        percentile: 62,
        classification: 'adequado',
        label: 'Peso adequado para a idade',
      },
      {
        measuredAt: '2025-08-14',
        ageMonths: 30,
        value: 14.6,
        percentile: 58,
        classification: 'adequado',
        label: 'Peso adequado para a idade',
      },
      {
        measuredAt: '2026-02-14',
        ageMonths: 36,
        value: 15.9,
        percentile: 55,
        classification: 'adequado',
        label: 'Peso adequado para a idade',
      },
      {
        measuredAt: '2026-08-01',
        ageMonths: 41.6,
        value: 17.1,
        percentile: 54,
        classification: 'adequado',
        label: 'Peso adequado para a idade',
      },
    ],
    latest: null,
  },
  {
    indicator: 'estatura_idade',
    label: 'Estatura para a idade',
    unit: 'cm',
    bands: bands(20, 44, (m) => 80 + m * 0.72),
    points: [
      {
        measuredAt: '2025-02-14',
        ageMonths: 24,
        value: 87.4,
        percentile: 45,
        classification: 'adequado',
        label: 'Estatura adequada para a idade',
      },
      {
        measuredAt: '2025-08-14',
        ageMonths: 30,
        value: 92.1,
        percentile: 48,
        classification: 'adequado',
        label: 'Estatura adequada para a idade',
      },
      {
        measuredAt: '2026-02-14',
        ageMonths: 36,
        value: 96.8,
        percentile: 51,
        classification: 'adequado',
        label: 'Estatura adequada para a idade',
      },
      {
        measuredAt: '2026-08-01',
        ageMonths: 41.6,
        value: 100.9,
        percentile: 52,
        classification: 'adequado',
        label: 'Estatura adequada para a idade',
      },
    ],
    latest: null,
  },
  {
    indicator: 'imc_idade',
    label: 'IMC para a idade',
    unit: 'kg/m²',
    bands: bands(20, 44, (m) => 16.4 - m * 0.02),
    points: [
      {
        measuredAt: '2025-02-14',
        ageMonths: 24,
        value: 17.5,
        percentile: 82,
        classification: 'adequado',
        label: 'Eutrofia',
      },
      {
        measuredAt: '2025-08-14',
        ageMonths: 30,
        value: 17.2,
        percentile: 80,
        classification: 'adequado',
        label: 'Eutrofia',
      },
      {
        measuredAt: '2026-02-14',
        ageMonths: 36,
        value: 17.0,
        percentile: 79,
        classification: 'adequado',
        label: 'Eutrofia',
      },
      {
        measuredAt: '2026-08-01',
        ageMonths: 41.6,
        value: 16.8,
        percentile: 78,
        classification: 'adequado',
        label: 'Eutrofia',
      },
    ],
    latest: null,
  },
]

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argIdx = process.argv.indexOf('--out')
  const outDir = resolve(argIdx >= 0 ? (process.argv[argIdx + 1] ?? '.') : './preview-impressos')
  await mkdir(outDir, { recursive: true })

  const comum = { clinicProfile: CLINICA, professionalName: PROFISSIONAL, issuedAt: EMITIDO_EM }

  const documentos: Array<[string, Promise<Buffer>]> = [
    ['1-plano-alimentar.pdf', renderPlanPdf({ ...comum, identity: ADULTA, plan: PLANO })],
    [
      '1b-plano-alimentar-rascunho.pdf',
      renderPlanPdf({ ...comum, identity: ADULTA, plan: { ...PLANO, status: 'rascunho' } }),
    ],
    [
      '2-evolucao-avaliacao.pdf',
      renderAssessmentPdf({ ...comum, identity: ADULTA, assessments: AVALIACOES }),
    ],
    ['3-orientacoes.pdf', renderCareNotesPdf({ ...comum, identity: ADULTA, notes: ORIENTACOES })],
    [
      '4-anamnese.pdf',
      renderAnamnesisPdf({
        ...comum,
        identity: ADULTA,
        templateTitle: 'Anamnese nutricional adulto',
        templateVersion: 2,
        fields: ANAMNESE_CAMPOS,
        responses: ANAMNESE_RESPOSTAS,
        createdAt: '2026-02-10T14:20:00Z',
      }),
    ],
    [
      '5-recordatorio.pdf',
      renderRecallPdf({ ...comum, identity: ADULTA, recall: RECORDATORIO, adequacy: ADEQUACAO }),
    ],
    [
      '6-exames.pdf',
      renderLabsPdf({ ...comum, identity: ADULTA, items: PAINEL.items, blockedBySex: 0 }),
    ],
    ['7-crescimento.pdf', renderGrowthPdf({ ...comum, identity: CRIANCA, curves: CURVAS })],
  ]

  for (const [nome, promessa] of documentos) {
    const buf = await promessa
    await writeFile(join(outDir, nome), buf)
    // eslint-disable-next-line no-console
    console.log(`${nome.padEnd(34)} ${(buf.length / 1024).toFixed(1)} KB`)
  }

  // eslint-disable-next-line no-console
  console.log(`\n${documentos.length} impressos em ${outDir}`)
}

void main()
