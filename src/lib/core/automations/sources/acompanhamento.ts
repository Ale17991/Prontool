/**
 * Feature 056 — fontes baseadas no acompanhamento clínico do paciente.
 *
 * As três leem o motor de medições da 030 e o plano alimentar da 047, e as três
 * são de ESTADO, não de evento — o que muda o desenho da chave de ocorrência.
 * Um paciente que atingiu a meta continua tendo atingido a meta amanhã; um
 * paciente sem medição há 30 dias segue sem medição no dia 31. Sem chave que
 * segure, cada uma viraria mensagem diária.
 *
 * `meta_atingida` é a exceção feliz: a chave é o id da meta, e uma meta é
 * atingida uma vez. Se a nutricionista lançar meta nova, é outro id e outra
 * comemoração — que é exatamente o comportamento desejado.
 */

import { z } from 'zod'
import { registerSource } from './registry'
import { addDias, dataCivilBr, eligiblePatients, mesesAtras, pageAll } from './shared'
import type { EnumerateContext, SourceCandidate } from '../types'

type Resposta = { data: unknown; error: { message: string } | null }

// ---------------------------------------------------------------------------
// Meta de acompanhamento atingida
// ---------------------------------------------------------------------------

registerSource({
  id: 'meta_atingida',
  label: 'Meta de acompanhamento atingida',
  group: 'acompanhamento',
  hint: 'Dispara quando a última medição do paciente alcança a meta lançada para aquela métrica (peso, circunferência, pressão...).',
  paramsSchema: z
    .object({
      metricType: z.string().min(1).max(60).optional(),
    })
    .strict(),
  fields: [
    {
      name: 'metricType',
      label: 'Qual métrica (deixe vazio para qualquer uma)',
      kind: 'select',
      optionsFrom: 'metric_types',
      hint: 'Vazio dispara para qualquer meta atingida — útil quando a clínica quer comemorar tudo com o mesmo texto.',
    },
  ],
  variables: ['metrica', 'valor', 'unidade', 'meta'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const { metricType } = ctx.params as { metricType?: string }
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    const metas = await pageAll<{
      id: string
      patient_id: string
      metric_type: string
      target_value: number
      direction: string
    }>((from, to) => {
      let q = ctx.supabase
        .from('patient_metric_goals')
        .select('id, patient_id, metric_type, target_value, direction')
        .eq('tenant_id', ctx.tenantId)
        .eq('active', true)
      if (metricType) q = q.eq('metric_type', metricType)
      return q.order('id').range(from, to) as unknown as PromiseLike<Resposta>
    }, 'meta_atingida.metas')
    if (metas.length === 0) return []

    // O rótulo da métrica vem do catálogo — global ou da clínica. Sem ele a
    // mensagem diria "seu peso_corporal", que é nome de coluna, não português.
    const tipos = await pageAll<{ metric_type: string; label: string; unit: string }>(
      (from, to) =>
        ctx.supabase
          .from('patient_metric_types')
          .select('metric_type, label, unit')
          .or(`tenant_id.is.null,tenant_id.eq.${ctx.tenantId}`)
          .order('metric_type')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'meta_atingida.tipos',
    )
    const rotulo = new Map(tipos.map((t) => [t.metric_type, t]))

    const out: SourceCandidate[] = []
    for (const meta of metas) {
      if (!aptos.has(meta.patient_id)) continue

      // A ÚLTIMA medição, não a melhor. Quem chegou na meta e voltou atrás não
      // recebe parabéns: seria comemorar um retrato que já não é o presente.
      const { data, error } = await ctx.supabase
        .from('patient_measurements')
        .select('value, unit, measured_at')
        .eq('tenant_id', ctx.tenantId)
        .eq('patient_id', meta.patient_id)
        .eq('metric_type', meta.metric_type)
        .order('measured_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error || !data) continue

      const m = data as { value: number; unit: string; measured_at: string }
      const atingiu =
        meta.direction === 'decrease' ? m.value <= meta.target_value : m.value >= meta.target_value
      if (!atingiu) continue

      const t = rotulo.get(meta.metric_type)
      out.push({
        patientId: meta.patient_id,
        // Uma meta é atingida uma vez. Meta nova é id novo, e comemorar de novo
        // é o certo.
        occurrenceKey: meta.id,
        variables: {
          metrica: t?.label ?? meta.metric_type,
          valor: formatarNumero(m.value),
          unidade: m.unit || (t?.unit ?? ''),
          meta: formatarNumero(meta.target_value),
        },
      })
    }
    return out
  },
})

// ---------------------------------------------------------------------------
// Sem medição registrada
// ---------------------------------------------------------------------------

registerSource({
  id: 'sem_medicao',
  label: 'Sem medição registrada há N dias',
  group: 'acompanhamento',
  hint: 'Dispara para quem já registrou alguma medição antes e está há N dias sem nenhuma nova. Repete no máximo uma vez por mês.',
  /**
   * A ausência de medição pode ser do PACIENTE (não pesou) ou da CLÍNICA (pesou
   * e ninguém lançou). O sistema não distingue, e a mensagem não pode acusar —
   * mesma família de cuidado do FR-009 no checklist.
   */
  warning:
    'O sistema sabe que NENHUMA medição foi registrada — não se o paciente deixou de se medir ou se a clínica deixou de lançar. Escreva como convite ("que tal atualizar seus números?"), nunca como cobrança.',
  paramsSchema: z.object({ dias: z.number().int().min(7).max(365) }).strict(),
  fields: [
    {
      name: 'dias',
      label: 'Dias sem nenhuma medição',
      kind: 'number',
      min: 7,
      max: 365,
      defaultValue: 30,
      hint: 'Mínimo de 7 dias: abaixo disso a mensagem chega antes de o acompanhamento fazer sentido.',
    },
  ],
  variables: ['dias', 'ultima_medicao'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const { dias } = ctx.params as { dias: number }
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    // Uma varredura só, e a decisão é por paciente em memória. Consultar "a
    // última medição de cada um" paciente a paciente seria uma ida ao banco por
    // pessoa da clínica inteira, todo dia.
    const medicoes = await pageAll<{ patient_id: string; measured_at: string }>(
      (from, to) =>
        ctx.supabase
          .from('patient_measurements')
          .select('patient_id, measured_at')
          .eq('tenant_id', ctx.tenantId)
          .order('patient_id')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'sem_medicao',
    )

    const ultima = new Map<string, string>()
    for (const m of medicoes) {
      const atual = ultima.get(m.patient_id)
      if (!atual || m.measured_at > atual) ultima.set(m.patient_id, m.measured_at)
    }

    const corte = addDias(ctx.today, -dias)
    const out: SourceCandidate[] = []
    for (const [patientId, quando] of ultima) {
      if (!aptos.has(patientId)) continue
      // `quando` é TIMESTAMPTZ; comparar com o dia civil da clínica pelo prefixo
      // é suficiente aqui porque o corte é de dezenas de dias — um erro de
      // fuso de três horas não muda de lado uma linha de 30 dias atrás.
      if (quando.slice(0, 10) > corte) continue

      // Quem NUNCA mediu não entra: a fonte é sobre acompanhamento
      // interrompido, e o `ultima` só tem quem já mediu ao menos uma vez.
      out.push({
        patientId,
        // Chave MENSAL, como `sem_retorno`: estado contínuo precisa de freio
        // próprio, senão vira mensagem diária até a pessoa se pesar.
        occurrenceKey: ctx.today.slice(0, 7),
        variables: { dias: String(dias), ultima_medicao: dataCivilBr(quando.slice(0, 10)) },
      })
    }
    return out
  },
})

// ---------------------------------------------------------------------------
// Plano alimentar pedindo revisão
// ---------------------------------------------------------------------------

registerSource({
  id: 'plano_alimentar_revisao',
  label: 'Plano alimentar ativo há N dias',
  group: 'acompanhamento',
  requiresModule: 'dieta',
  hint: 'Dispara quando o plano alimentar ativo do paciente completa N dias, para convidar à revisão.',
  paramsSchema: z.object({ dias: z.number().int().min(7).max(365) }).strict(),
  fields: [
    {
      name: 'dias',
      label: 'Dias desde a prescrição',
      kind: 'number',
      min: 7,
      max: 365,
      defaultValue: 30,
    },
  ],
  variables: ['plano', 'dias', 'desde'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const { dias } = ctx.params as { dias: number }
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    const alvo = addDias(ctx.today, -dias)

    const planos = await pageAll<{
      id: string
      patient_id: string
      title: string
      created_at: string
      status: string
    }>(
      (from, to) =>
        ctx.supabase
          .from('diet_plans')
          .select('id, patient_id, title, created_at, status')
          .eq('tenant_id', ctx.tenantId)
          .eq('active', true)
          .gte('created_at', `${alvo}T00:00:00.000Z`)
          .lt('created_at', `${addDias(alvo, 1)}T00:00:00.000Z`)
          .order('id')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'plano_alimentar_revisao',
    )

    return planos
      .filter((p) => aptos.has(p.patient_id))
      .map((p) => ({
        patientId: p.patient_id,
        // Um convite por PLANO. Plano novo (a revisão que este convite pediu) é
        // id novo, e volta a contar do zero.
        occurrenceKey: p.id,
        variables: {
          plano: p.title,
          dias: String(dias),
          desde: dataCivilBr(p.created_at.slice(0, 10)),
        },
      }))
  },
})

/** Sem casas decimais inúteis: 72 é "72", 71,5 continua "71,5". */
function formatarNumero(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

// ---------------------------------------------------------------------------
// Sem recordatório alimentar
// ---------------------------------------------------------------------------

registerSource({
  id: 'recordatorio_em_branco',
  label: 'Sem recordatório alimentar há N dias',
  group: 'acompanhamento',
  requiresModule: 'nutri_recordatorio',
  hint: 'Dispara para quem já enviou algum recordatório antes e está há N dias sem enviar nenhum. Repete no máximo uma vez por mês.',
  /**
   * Aqui a ausência é do PACIENTE — o recordatório é ele quem preenche —, mas
   * "não preencheu" continua não sendo "não comeu direito", e a mensagem não
   * pode sugerir que alguém está sendo vigiado no prato.
   */
  warning:
    'O sistema sabe que nenhum recordatório foi ENVIADO — não o que o paciente comeu. Escreva como convite para registrar, nunca como cobrança de dieta.',
  paramsSchema: z.object({ dias: z.number().int().min(3).max(120) }).strict(),
  fields: [
    {
      name: 'dias',
      label: 'Dias sem nenhum recordatório',
      kind: 'number',
      min: 3,
      max: 120,
      defaultValue: 14,
      hint: 'Abaixo de 3 dias a mensagem chega antes de haver o que registrar.',
    },
  ],
  variables: ['dias', 'ultimo_recordatorio'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    return ultimoRegistroAntigo(ctx, {
      tabela: 'food_recalls',
      coluna: 'recall_date',
      corte: addDias(ctx.today, -(ctx.params as { dias: number }).dias),
      rotulo: 'recordatorio_em_branco',
      variaveis: (quando) => ({
        dias: String((ctx.params as { dias: number }).dias),
        ultimo_recordatorio: dataCivilBr(quando),
      }),
    })
  },
})

// ---------------------------------------------------------------------------
// Avaliação nutricional vencida
// ---------------------------------------------------------------------------

registerSource({
  id: 'avaliacao_vencida',
  label: 'Última avaliação há N meses',
  group: 'acompanhamento',
  requiresModule: 'nutri_avaliacao',
  hint: 'Dispara para quem já foi avaliado e está há N meses sem nova avaliação. Repete no máximo uma vez por mês.',
  /**
   * Esta NÃO leva aviso, e a diferença é real: a avaliação é feita PELA
   * CLÍNICA. Não há inferência sobre o comportamento do paciente a policiar —
   * o convite para reavaliar é sobre a agenda dela, não sobre a conduta dele.
   */
  paramsSchema: z.object({ meses: z.number().int().min(1).max(36) }).strict(),
  fields: [
    {
      name: 'meses',
      label: 'Meses desde a última avaliação',
      kind: 'number',
      min: 1,
      max: 36,
      defaultValue: 6,
    },
  ],
  variables: ['meses', 'ultima_avaliacao'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const { meses } = ctx.params as { meses: number }
    return ultimoRegistroAntigo(ctx, {
      tabela: 'nutrition_assessments',
      // Coluna DATE — sem fuso, e por isso comparável direto com o dia civil
      // da clínica. É a mesma distinção que a 058 firmou em `brDateOnly`.
      coluna: 'assessed_at',
      corte: mesesAtras(ctx.today, meses),
      rotulo: 'avaliacao_vencida',
      variaveis: (quando) => ({
        meses: String(meses),
        ultima_avaliacao: dataCivilBr(quando),
      }),
    })
  },
})

/**
 * "Já teve, e o último foi antes do corte" — a forma que `recordatorio_em_branco`
 * e `avaliacao_vencida` compartilham, e que `sem_medicao` também tem escrita à
 * mão logo acima.
 *
 * QUEM NUNCA TEVE NÃO ENTRA, e isso não é detalhe de implementação: a fonte é
 * sobre acompanhamento INTERROMPIDO. Mandar "faz tempo que não recebemos seu
 * recordatório" para quem jamais enviou um soa como mensagem trocada, porque é.
 *
 * A chave é MENSAL porque o estado é contínuo: quem está há 40 dias sem
 * registrar segue assim no dia 41, e sem freio próprio isso vira mensagem
 * diária até a pessoa ceder.
 */
async function ultimoRegistroAntigo(
  ctx: EnumerateContext,
  cfg: {
    tabela: string
    coluna: string
    corte: string
    rotulo: string
    variaveis: (quando: string) => Record<string, string>
  },
): Promise<SourceCandidate[]> {
  const aptos = await eligiblePatients(ctx)
  if (aptos.size === 0) return []

  // Uma varredura só, decisão em memória — pelo mesmo motivo de `sem_medicao`:
  // perguntar "qual o último de cada um" paciente a paciente seria uma ida ao
  // banco por pessoa da clínica, todo dia.
  const linhas = await pageAll<Record<string, string>>(
    (from, to) =>
      ctx.supabase
        .from(cfg.tabela)
        .select(`patient_id, ${cfg.coluna}`)
        .eq('tenant_id', ctx.tenantId)
        .order('patient_id')
        .range(from, to) as unknown as PromiseLike<Resposta>,
    cfg.rotulo,
  )

  const ultima = new Map<string, string>()
  for (const linha of linhas) {
    const patientId = linha.patient_id
    const quando = (linha[cfg.coluna] ?? '').slice(0, 10)
    if (!patientId || !quando) continue
    const atual = ultima.get(patientId)
    if (!atual || quando > atual) ultima.set(patientId, quando)
  }

  const out: SourceCandidate[] = []
  for (const [patientId, quando] of ultima) {
    if (!aptos.has(patientId)) continue
    if (quando > cfg.corte) continue
    out.push({
      patientId,
      occurrenceKey: ctx.today.slice(0, 7),
      variables: cfg.variaveis(quando),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Afastando-se da meta
// ---------------------------------------------------------------------------

registerSource({
  id: 'afastando_da_meta',
  label: 'Medições consecutivas afastando-se da meta',
  group: 'acompanhamento',
  hint: 'Dispara quando as últimas medições andam, seguidas, na direção contrária à meta lançada. Repete no máximo uma vez por mês.',
  /**
   * ESTA FONTE NÃO OFERECE O VALOR NEM A VARIAÇÃO, e a ausência é o guarda-corpo.
   *
   * Mandar "seu peso subiu 2 kg" por WhatsApp é devolver um dado clínico sem
   * ninguém junto para interpretá-lo, a um público que frequentemente tem
   * relação difícil com esse número. A regra existe para TRAZER O PACIENTE À
   * CONSULTA, não para dar o veredito por mensagem — e a restrição mora aqui,
   * na fonte, para não depender da boa vontade de quem escreve o texto: a
   * validação de variáveis recusa, na hora de associar, um texto que peça o que
   * a fonte não fornece.
   */
  warning:
    'A mensagem NÃO deve citar números nem dizer que algo piorou. Convide para uma conversa ("que tal a gente se falar?") — o resultado se interpreta na consulta, com a profissional junto.',
  paramsSchema: z
    .object({
      metricType: z.string().min(1).max(60),
      consecutivas: z.number().int().min(2).max(10),
    })
    .strict(),
  fields: [
    {
      name: 'metricType',
      label: 'Qual métrica',
      kind: 'select',
      optionsFrom: 'metric_types',
      hint: 'Só métricas com meta lançada entram — sem meta não existe "direção contrária".',
    },
    {
      name: 'consecutivas',
      label: 'Quantas medições seguidas na direção contrária',
      kind: 'number',
      min: 2,
      max: 10,
      defaultValue: 3,
      hint: 'Duas já é uma tendência; três evita reagir a uma oscilação isolada.',
    },
  ],
  variables: ['metrica'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const { metricType, consecutivas } = ctx.params as {
      metricType: string
      consecutivas: number
    }
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    const metas = await pageAll<{
      patient_id: string
      metric_type: string
      direction: string
      target_value: number
    }>(
      (from, to) =>
        ctx.supabase
          .from('patient_metric_goals')
          .select('patient_id, metric_type, direction, target_value')
          .eq('tenant_id', ctx.tenantId)
          .eq('metric_type', metricType)
          .eq('active', true)
          .order('patient_id')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'afastando_da_meta.metas',
    )
    if (metas.length === 0) return []

    const medicoes = await pageAll<{ patient_id: string; value: number; measured_at: string }>(
      (from, to) =>
        ctx.supabase
          .from('patient_measurements')
          .select('patient_id, value, measured_at')
          .eq('tenant_id', ctx.tenantId)
          .eq('metric_type', metricType)
          .order('measured_at', { ascending: false })
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'afastando_da_meta.medicoes',
    )

    // `consecutivas` TRANSIÇÕES exigem `consecutivas + 1` medições. Guardar só
    // essas: a base inteira de um paciente antigo não muda a resposta e custa
    // memória à toa.
    const necessarias = consecutivas + 1
    const porPaciente = new Map<string, number[]>()
    for (const m of medicoes) {
      const lista = porPaciente.get(m.patient_id) ?? []
      if (lista.length < necessarias) {
        lista.push(m.value)
        porPaciente.set(m.patient_id, lista)
      }
    }

    const tipos = await pageAll<{ metric_type: string; label: string }>(
      (from, to) =>
        ctx.supabase
          .from('patient_metric_types')
          .select('metric_type, label')
          .or(`tenant_id.is.null,tenant_id.eq.${ctx.tenantId}`)
          .order('metric_type')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'afastando_da_meta.tipos',
    )
    const rotulo = new Map(tipos.map((t) => [t.metric_type, t.label]))

    const out: SourceCandidate[] = []
    for (const meta of metas) {
      if (!aptos.has(meta.patient_id)) continue
      const valores = porPaciente.get(meta.patient_id) ?? []
      if (valores.length < necessarias) continue

      // Já está na meta? Então não está se afastando dela, mesmo tendo
      // oscilado — cobrar quem já chegou é o oposto do que a fonte quer.
      const decrescente = meta.direction === 'decrease'
      const atual = valores[0]!
      if (decrescente ? atual <= meta.target_value : atual >= meta.target_value) continue

      // A lista vem do mais NOVO para o mais antigo, então cada par é uma
      // transição do antigo (i+1) para o novo (i).
      let afastou = true
      for (let i = 0; i < consecutivas; i++) {
        const novo = valores[i]!
        const velho = valores[i + 1]!
        const piorou = decrescente ? novo > velho : novo < velho
        if (!piorou) {
          afastou = false
          break
        }
      }
      if (!afastou) continue

      out.push({
        patientId: meta.patient_id,
        // Mensal: a tendência não se desfaz da noite para o dia, e sem freio
        // isto vira cobrança diária de quem já está numa fase difícil.
        occurrenceKey: ctx.today.slice(0, 7),
        variables: { metrica: rotulo.get(meta.metric_type) ?? meta.metric_type },
      })
    }
    return out
  },
})
