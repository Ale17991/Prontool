/**
 * Feature 053 — o catálogo de famílias de regra.
 *
 * É CÓDIGO, não tabela. Mesmo tratamento dado aos números da IN 75/2020 na 052
 * e ao catálogo de analitos na 050: definição de família é produto, não
 * configuração de clínica. Em TS ela fica versionada no git, revisável em PR,
 * coberta por teste e impossível de uma clínica corromper. Família nova é PR,
 * não migração de dados.
 *
 * ---
 *
 * DUAS NATUREZAS, e a distinção não é temática — muda quais filtros se aplicam:
 *
 *   CELEBRAÇÃO observa evento PRESENTE no dado (atingiu a meta, marcou sete
 *   dias, fez aniversário). Não há suposição a controlar nem acusação possível,
 *   então escapa do filtro de portal e da lista de expressões proibidas, que
 *   existem só para proteger contra a inferência de ausência.
 *
 *   AUSÊNCIA observa a falta de um registro, que é sempre ambígua.
 *
 * A faixa de `priority` codifica a precedência: celebração 1–9, ausência 10+.
 * Assim, quando o teto semanal do paciente binda, o desempate por prioridade já
 * entrega a mensagem que reconhece em vez da que cobra — sem lógica extra. Um
 * sistema que só sabe cobrar treina o paciente a temer a mensagem da clínica, e
 * aí ele para de ler todas, inclusive o lembrete de consulta.
 *
 * ---
 *
 * `implemented: false` marca família já definida cujo `evaluate` ainda não
 * chegou (entrega incremental por fase). A API recusa criar regra para ela e a
 * tela não a lista. As invariantes do catálogo, porém, já valem para todas —
 * é o contrato que segura o desenho enquanto as implementações chegam.
 */

import { z } from 'zod'
import type { SignalFamily, SignalFamilyId, SignalNature } from './types'
import { evaluateHabitoSemRegistro } from './families/ausencia/habito-sem-registro'
import { evaluateSemAcessoPortal } from './families/ausencia/sem-acesso-portal'
import { evaluateMetaAtingida } from './families/celebracao/meta-atingida'
import { evaluateSequenciaHabito } from './families/celebracao/sequencia-habito'
import { evaluateAniversario } from './families/celebracao/aniversario'
import { evaluateAniversarioAcompanhamento } from './families/celebracao/aniversario-acompanhamento'
import { evaluatePosConsulta } from './families/celebracao/pos-consulta'

const dias = (min: number, max: number) => z.number().int().min(min).max(max)

/** Placeholder comum a todas: nome do paciente e nome da clínica. */
const BASE_PLACEHOLDERS = ['paciente', 'clinica'] as const

function naoImplementada(id: SignalFamilyId) {
  return async () => {
    throw new Error(`Família "${id}" ainda não tem evaluate implementado`)
  }
}

export interface SignalFamilyDef extends SignalFamily {
  implemented: boolean
}

// ===========================================================================
// CELEBRAÇÃO — prioridade 1–9
// ===========================================================================

const CELEBRACAO: SignalFamilyDef[] = [
  {
    id: 'meta_atingida',
    nature: 'celebracao',
    priority: 1,
    label: 'Meta atingida',
    description: 'Reconhece quando o paciente alcança uma meta ativa.',
    // Dispara na VIRADA (a medição anterior não tinha alcançado), não todo dia
    // depois — senão vira ruído justamente no melhor momento.
    paramsSchema: z.object({ metricType: z.string().min(1) }),
    // SEM placeholder de valor. Mandar "seu peso caiu 4 kg" parece inofensivo,
    // mas é dado clínico sem interlocutor e estabelece que o NÚMERO é o
    // assunto — o que torna a mensagem seguinte, quando ele subir, muito pior.
    placeholders: [...BASE_PLACEHOLDERS, 'metrica'],
    defaultTemplate:
      'Oi {{paciente}}, aqui é da {{clinica}}. Vimos que você alcançou sua meta de {{metrica}}. Parabéns pela constância — isso é resultado do seu esforço. Seguimos juntos!',
    defaultSilenceDays: 30,
    requiresPortalActivity: false,
    implemented: true,
    evaluate: evaluateMetaAtingida,
  },
  {
    id: 'sequencia_habito',
    nature: 'celebracao',
    priority: 2,
    label: 'Sequência de hábito',
    description: 'Reconhece uma sequência de dias marcando o mesmo hábito.',
    paramsSchema: z.object({ itemId: z.string().min(1).optional(), days: dias(2, 90) }),
    placeholders: [...BASE_PLACEHOLDERS, 'habito', 'dias'],
    defaultTemplate:
      'Oi {{paciente}}! São {{dias}} dias seguidos com {{habito}} em dia. Que sequência! A {{clinica}} está torcendo por você.',
    defaultSilenceDays: 14,
    requiresPortalActivity: false,
    implemented: true,
    evaluate: evaluateSequenciaHabito,
  },
  {
    id: 'aniversario',
    nature: 'celebracao',
    priority: 3,
    label: 'Aniversário do paciente',
    description: 'Mensagem de aniversário.',
    paramsSchema: z.object({}),
    placeholders: [...BASE_PLACEHOLDERS],
    defaultTemplate: 'Oi {{paciente}}, feliz aniversário! Um abraço de todos nós da {{clinica}}.',
    defaultSilenceDays: 300,
    requiresPortalActivity: false,
    implemented: true,
    evaluate: evaluateAniversario,
  },
  {
    id: 'aniversario_acompanhamento',
    nature: 'celebracao',
    priority: 4,
    label: 'Aniversário de acompanhamento',
    description: 'Marca os meses de acompanhamento desde a primeira consulta.',
    paramsSchema: z.object({ months: dias(1, 60) }),
    placeholders: [...BASE_PLACEHOLDERS, 'meses'],
    defaultTemplate:
      'Oi {{paciente}}! Hoje faz {{meses}} meses que você começou seu acompanhamento com a {{clinica}}. Obrigado pela confiança em todo esse caminho.',
    defaultSilenceDays: 60,
    requiresPortalActivity: false,
    implemented: true,
    evaluate: evaluateAniversarioAcompanhamento,
  },
  {
    id: 'pos_consulta',
    nature: 'celebracao',
    priority: 5,
    label: 'Depois da consulta',
    description: 'Mensagem de acolhimento alguns dias após a consulta.',
    paramsSchema: z.object({ days: dias(1, 30) }),
    placeholders: [...BASE_PLACEHOLDERS, 'dias'],
    defaultTemplate:
      'Oi {{paciente}}, aqui é da {{clinica}}. Faz {{dias}} dias da sua consulta e queríamos saber como você está se sentindo. Qualquer dúvida, é só chamar.',
    defaultSilenceDays: 7,
    requiresPortalActivity: false,
    implemented: true,
    evaluate: evaluatePosConsulta,
  },
]

// ===========================================================================
// AUSÊNCIA — prioridade 10+
// ===========================================================================

const AUSENCIA: SignalFamilyDef[] = [
  {
    id: 'sem_acesso_portal',
    nature: 'ausencia',
    // A mais alta entre as ausências: é ela que atende quem as outras
    // suprimiram por falta de atividade no portal. Sem essa precedência, o
    // paciente sumido ficaria sem contato nenhum — pior que o problema
    // original.
    priority: 10,
    label: 'Sem acessar o portal',
    description: 'O paciente não abre o portal há um tempo.',
    paramsSchema: z.object({ days: dias(3, 180) }),
    placeholders: [...BASE_PLACEHOLDERS, 'dias'],
    defaultTemplate:
      'Oi {{paciente}}, aqui é da {{clinica}}. Faz {{dias}} dias que não vemos você por aqui. Está tudo bem? Se precisar de ajuda para retomar, é só falar com a gente.',
    defaultSilenceDays: 14,
    // FALSE de propósito: é justamente ela que observa o sumiço. Aplicar o
    // filtro de atividade no portal aqui anularia a própria família.
    requiresPortalActivity: false,
    implemented: true,
    evaluate: evaluateSemAcessoPortal,
  },
  {
    id: 'habito_sem_registro',
    nature: 'ausencia',
    priority: 20,
    label: 'Hábito sem registro',
    description: 'Um item do checklist sem marcação por vários dias seguidos.',
    paramsSchema: z.object({ itemId: z.string().min(1).optional(), days: dias(2, 60) }),
    placeholders: [...BASE_PLACEHOLDERS, 'habito', 'dias'],
    defaultTemplate:
      'Oi {{paciente}}, aqui é da {{clinica}}. Não vimos seu registro de {{habito}} nos últimos {{dias}} dias. Se estiver tudo certo e só faltou marcar, é só abrir o portal quando puder. Se algo atrapalhou, conte pra gente — a gente ajusta junto.',
    defaultSilenceDays: 7,
    requiresPortalActivity: true,
    implemented: true,
    evaluate: evaluateHabitoSemRegistro,
  },
  {
    id: 'sem_registrar_medicao',
    nature: 'ausencia',
    priority: 30,
    label: 'Sem registrar medição',
    description: 'Uma métrica sem registro novo há um tempo.',
    paramsSchema: z.object({ metricType: z.string().min(1), days: dias(3, 180) }),
    placeholders: [...BASE_PLACEHOLDERS, 'metrica', 'dias'],
    defaultTemplate:
      'Oi {{paciente}}, aqui é da {{clinica}}. Não vimos um registro novo de {{metrica}} nos últimos {{dias}} dias. Quando puder, atualize no portal — assim conseguimos acompanhar melhor sua evolução.',
    defaultSilenceDays: 10,
    requiresPortalActivity: true,
    implemented: false,
    evaluate: naoImplementada('sem_registrar_medicao'),
  },
  {
    id: 'recordatorio_em_branco',
    nature: 'ausencia',
    priority: 35,
    label: 'Recordatório em branco',
    description: 'Sem recordatório alimentar preenchido há um tempo.',
    paramsSchema: z.object({ days: dias(3, 120) }),
    placeholders: [...BASE_PLACEHOLDERS, 'dias'],
    defaultTemplate:
      'Oi {{paciente}}, aqui é da {{clinica}}. Faz {{dias}} dias que não recebemos um recordatório alimentar seu. Se puder registrar quando der, ajuda muito no seu acompanhamento.',
    defaultSilenceDays: 10,
    requiresPortalActivity: true,
    implemented: false,
    evaluate: naoImplementada('recordatorio_em_branco'),
  },
  {
    id: 'afastando_da_meta',
    nature: 'ausencia',
    priority: 40,
    label: 'Afastando-se da meta',
    description: 'Medições consecutivas na direção contrária à meta.',
    paramsSchema: z.object({ metricType: z.string().min(1), consecutive: dias(2, 10) }),
    // SEM placeholder de valor nem de variação — ver a nota de `meta_atingida`.
    // A regra existe para TRAZER O PACIENTE À CONSULTA, não para dar veredito
    // por mensagem.
    placeholders: [...BASE_PLACEHOLDERS, 'metrica'],
    defaultTemplate:
      'Oi {{paciente}}, aqui é da {{clinica}}. Demos uma olhada no seu acompanhamento de {{metrica}} e queríamos conversar sobre ele com você. Que tal marcarmos um horário?',
    defaultSilenceDays: 21,
    requiresPortalActivity: false,
    implemented: false,
    evaluate: naoImplementada('afastando_da_meta'),
  },
  {
    id: 'exame_nao_realizado',
    nature: 'ausencia',
    priority: 45,
    label: 'Exame não realizado',
    description: 'Exame solicitado sem resultado registrado depois.',
    paramsSchema: z.object({ days: dias(3, 365) }),
    placeholders: [...BASE_PLACEHOLDERS, 'dias'],
    defaultTemplate:
      'Oi {{paciente}}, aqui é da {{clinica}}. Faz {{dias}} dias que pedimos seus exames e ainda não recebemos o resultado. Se já fez, pode nos enviar. Se ainda não, podemos ajudar a agendar.',
    defaultSilenceDays: 15,
    requiresPortalActivity: false,
    implemented: false,
    evaluate: naoImplementada('exame_nao_realizado'),
  },
  {
    id: 'sem_retorno',
    nature: 'ausencia',
    priority: 50,
    label: 'Sem retorno',
    description: 'Sem consulta há meses e sem retorno marcado.',
    paramsSchema: z.object({ months: dias(1, 36) }),
    placeholders: [...BASE_PLACEHOLDERS, 'meses'],
    defaultTemplate:
      'Oi {{paciente}}, aqui é da {{clinica}}. Faz {{meses}} meses desde sua última consulta e não vemos um retorno agendado. Se quiser retomar o acompanhamento, temos horários disponíveis.',
    defaultSilenceDays: 45,
    requiresPortalActivity: false,
    implemented: false,
    evaluate: naoImplementada('sem_retorno'),
  },
  {
    id: 'avaliacao_vencida',
    nature: 'ausencia',
    priority: 55,
    label: 'Avaliação vencida',
    description: 'Última avaliação nutricional há muitos meses.',
    paramsSchema: z.object({ months: dias(1, 36) }),
    placeholders: [...BASE_PLACEHOLDERS, 'meses'],
    defaultTemplate:
      'Oi {{paciente}}, aqui é da {{clinica}}. Sua última avaliação foi há {{meses}} meses. Uma reavaliação ajuda a ajustar o que for preciso — quer marcar?',
    defaultSilenceDays: 30,
    requiresPortalActivity: false,
    implemented: false,
    evaluate: naoImplementada('avaliacao_vencida'),
  },
  {
    id: 'plano_sem_revisao',
    nature: 'ausencia',
    priority: 60,
    label: 'Plano alimentar sem revisão',
    description: 'Prescrição ativa criada há muitos meses, sem revisão.',
    paramsSchema: z.object({ months: dias(1, 36) }),
    placeholders: [...BASE_PLACEHOLDERS, 'meses'],
    defaultTemplate:
      'Oi {{paciente}}, aqui é da {{clinica}}. Seu plano alimentar está com {{meses}} meses. Vale uma revisão para deixá-lo alinhado ao seu momento atual. Podemos agendar?',
    defaultSilenceDays: 45,
    requiresPortalActivity: false,
    implemented: false,
    evaluate: naoImplementada('plano_sem_revisao'),
  },
]

export const CATALOG: readonly SignalFamilyDef[] = [...CELEBRACAO, ...AUSENCIA]

const BY_ID = new Map<SignalFamilyId, SignalFamilyDef>(CATALOG.map((f) => [f.id, f]))

export function familyById(id: string): SignalFamilyDef | null {
  return BY_ID.get(id as SignalFamilyId) ?? null
}

export function familiesByNature(nature: SignalNature): SignalFamilyDef[] {
  return CATALOG.filter((f) => f.nature === nature)
}

/**
 * O que a tela pode oferecer e a API pode aceitar. Família definida mas sem
 * `evaluate` não aparece: ligar uma regra que o ciclo não sabe avaliar geraria
 * uma clínica esperando mensagem que nunca vem.
 */
export function implementedFamilies(): SignalFamilyDef[] {
  return CATALOG.filter((f) => f.implemented)
}
