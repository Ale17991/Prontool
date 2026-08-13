import type { PatientPortalBundle } from './read-portal'
import type { PortalSectionKey } from './sections'
import { brDayInClinicTz, brDayTimeInClinicTz } from './format'

/**
 * Feature 057 — o que a tela inicial do portal mostra.
 *
 * Função PURA, fora do componente, por dois motivos. Primeiro, é aqui que moram
 * as regras que o spec descreve — o que fica aberto, o que vira card, o que sobe
 * quando a home ficaria vazia — e regra dentro de JSX não se testa sem renderizar
 * página. Segundo, a decisão "quem é promovido" e a decisão "quem vira card" TÊM
 * que ler a mesma lista: separadas, a área promovida acabaria aparecendo também
 * como card na primeira vez que alguém mexesse numa das duas.
 *
 * Ícone e cor ficam de fora de propósito: são do componente, e trazê-los para cá
 * obrigaria o teste a importar React para conferir uma regra de negócio.
 */

/** Ordem do catálogo `PORTAL_SECTIONS` — igual para todas as clínicas (FR-003). */
const AREAS: ReadonlyArray<{ key: PortalSectionKey; label: string; path: string }> = [
  { key: 'atendimentos', label: 'Meus atendimentos', path: 'atendimentos' },
  { key: 'metricas', label: 'Minha evolução', path: 'evolucao' },
  { key: 'orientacoes', label: 'Orientações', path: 'orientacoes' },
  { key: 'exames', label: 'Resultados de exames', path: 'exames' },
  { key: 'treino', label: 'Rotina de treino', path: 'treino' },
  { key: 'dieta', label: 'Plano alimentar', path: 'dieta' },
]

export interface PortalHomeCard {
  key: PortalSectionKey
  label: string
  /** Trecho final da URL, sob `/paciente/[slug]/painel/`. */
  path: string
  /** Prévia do conteúdo (FR-004). Vazio quando não há o que prever. */
  hint: string
  /** Sem conteúdo ⇒ card apagado e sem link (FR-008). */
  empty: boolean
  emptyHint: string
}

export interface PortalHomeLayout {
  showGoals: boolean
  showHabitos: boolean
  showWelcome: boolean
  /** Área aberta na home quando metas e checklist não se aplicam (FR-017). */
  promoted: PortalSectionKey | null
  /** Já SEM a área promovida (FR-019). */
  cards: PortalHomeCard[]
  /** "14/08 às 15h", ou null (FR-014/016). */
  nextAppointment: string | null
  /** false ⇒ a home mostra a mensagem de "ainda não há informações" (FR-020). */
  hasAnything: boolean
}

export interface PortalHomeInput {
  enabled: Set<PortalSectionKey>
  bundle: PatientPortalBundle
  /** Existe checklist ativo para este paciente? Decidido no servidor. */
  hasChecklist: boolean
  /** Recado da clínica, já normalizado (`null` quando não escrito). */
  welcomeText: string | null
  /** Injetável para teste; produção usa o relógio. */
  nowMs?: number
}

export function buildPortalHome(input: PortalHomeInput): PortalHomeLayout {
  const { enabled, bundle, hasChecklist, welcomeText } = input
  const now = input.nowMs ?? Date.now()

  const hasAnyMetric = Object.values(bundle.metrics).some((s) => s.length > 0)
  const hasMetricData = bundle.weightImc.length > 0 || hasAnyMetric
  const labCount = bundle.labResults?.length ?? 0

  const showGoals = enabled.has('metas') && bundle.goals.length > 0
  // Seção ligada COM checklist montado. Grade em branco é conteúdo — é o que se
  // pede que o paciente preencha.
  const showHabitos = enabled.has('habitos') && hasChecklist

  const candidates: PortalHomeCard[] = []
  for (const area of AREAS) {
    if (!enabled.has(area.key)) continue
    const card = { key: area.key, label: area.label, path: area.path }
    switch (area.key) {
      case 'atendimentos':
        candidates.push({
          ...card,
          hint: appointmentsHint(bundle.appointments, now),
          empty: bundle.appointments.length === 0,
          emptyHint: 'Nenhum atendimento registrado ainda.',
        })
        break
      case 'metricas':
        candidates.push({
          ...card,
          hint: metricsHint(bundle),
          empty: !hasMetricData,
          emptyHint: 'Suas medições aparecem aqui após a consulta.',
        })
        break
      case 'orientacoes':
        candidates.push({
          ...card,
          hint:
            bundle.careNotes.length === 1
              ? '1 orientação da equipe'
              : `${bundle.careNotes.length} orientações da equipe`,
          empty: bundle.careNotes.length === 0,
          emptyHint: 'A equipe ainda não escreveu orientações.',
        })
        break
      case 'exames':
        candidates.push({
          ...card,
          hint: labCount === 1 ? '1 resultado recente' : `${labCount} resultados recentes`,
          empty: labCount === 0,
          emptyHint: 'Nenhum resultado disponível ainda.',
        })
        break
      case 'treino':
        candidates.push({
          ...card,
          hint: bundle.workout?.title ?? '',
          empty: !bundle.workout,
          emptyHint: 'Seu profissional ainda não cadastrou sua rotina.',
        })
        break
      case 'dieta':
        candidates.push({
          ...card,
          hint: bundle.diet?.title ?? '',
          empty: !bundle.diet,
          emptyHint: 'Seu nutricionista ainda não cadastrou seu plano.',
        })
        break
    }
  }

  // Promoção só quando a home ficaria sem conteúdo próprio.
  const promoted =
    !showGoals && !showHabitos ? (candidates.find((c) => !c.empty)?.key ?? null) : null
  const cards = promoted ? candidates.filter((c) => c.key !== promoted) : candidates
  // O recado preenche uma tela que ficaria vazia; não é mural.
  const showWelcome = !showGoals && !showHabitos && !!welcomeText

  // A próxima consulta só existe se a clínica expõe a área de atendimentos —
  // senão o cabeçalho contornaria a decisão dela (FR-015).
  const next = enabled.has('atendimentos') ? nextFuture(bundle.appointments, now) : null

  return {
    showGoals,
    showHabitos,
    showWelcome,
    promoted,
    cards,
    nextAppointment: next ? brDayTimeInClinicTz(next.appointmentAt) : null,
    hasAnything: showGoals || showHabitos || showWelcome || promoted !== null || cards.length > 0,
  }
}

/** A consulta futura mais próxima. A lista vem decrescente: é a ÚLTIMA das futuras. */
function nextFuture<T extends { appointmentAt: string }>(appointments: T[], now: number): T | null {
  const future = appointments.filter((a) => new Date(a.appointmentAt).getTime() >= now)
  return future.length > 0 ? future[future.length - 1]! : null
}

/** Consulta futura passa na frente da passada: é a pergunta que traz o paciente. */
function appointmentsHint(appointments: Array<{ appointmentAt: string }>, now: number): string {
  if (appointments.length === 0) return ''
  const next = nextFuture(appointments, now)
  if (next) return `Próxima em ${brDayInClinicTz(next.appointmentAt)}`
  return `Último em ${brDayInClinicTz(appointments[0]!.appointmentAt)}`
}

function metricsHint(bundle: {
  weightImc: Array<{ measuredAt: string }>
  metrics: Record<string, Array<{ measuredAt: string }>>
}): string {
  const dates: string[] = bundle.weightImc.map((p) => p.measuredAt)
  for (const series of Object.values(bundle.metrics)) {
    for (const m of series) dates.push(m.measuredAt)
  }
  if (dates.length === 0) return ''
  const latest = dates.reduce((a, b) => (new Date(b).getTime() > new Date(a).getTime() ? b : a))
  return `Atualizado em ${brDayInClinicTz(latest)}`
}
