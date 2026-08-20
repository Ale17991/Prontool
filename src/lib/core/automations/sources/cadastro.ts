/**
 * Feature 056 — fontes baseadas no cadastro do paciente.
 *
 * As duas mais baratas do conjunto: `patients.created_at` não é PII cifrada,
 * então a enumeração é uma consulta com recorte de data e nada mais. Diferente
 * do aniversário de nascimento, que precisa decifrar paciente a paciente porque
 * `birth_date` é cifrado e não dá para comparar dia e mês em SQL.
 */

import { z } from 'zod'
import { registerSource } from './registry'
import {
  addDias,
  antecedenciaSchema,
  dataCivilBr,
  ancorada,
  lerAntecedencia,
  emDias,
  janelaAncorada,
  janelaDoDia,
  pageAll,
  MINUTOS_POR_DIA,
} from './shared'
import type { EnumerateContext, SourceCandidate } from '../types'

type Resposta = { data: unknown; error: { message: string } | null }

/**
 * Os pacientes cadastrados num dia civil, já filtrados por elegibilidade.
 *
 * Filtra no BANCO em vez de cruzar com `eligiblePatients` em memória porque o
 * recorte de data já é estreito: um dia de cadastros é dezenas de linhas, e
 * carregar a base inteira de aptos para intersectar com elas seria pagar caro
 * pelo lado errado.
 */
async function cadastradosEntre(ctx: EnumerateContext, janela: { de: string; ate: string }) {
  const { de, ate } = janela
  return pageAll<{ id: string; created_at: string }>(
    (from, to) =>
      ctx.supabase
        .from('patients')
        .select('id, created_at')
        .eq('tenant_id', ctx.tenantId)
        .eq('status', 'ativo')
        .eq('automations_opt_in', true)
        .is('anonymized_at', null)
        .not('phone_enc', 'is', null)
        .gte('created_at', de)
        .lt('created_at', ate)
        .order('id')
        .range(from, to) as unknown as PromiseLike<Resposta>,
    'cadastradosEntre',
  )
}

// ---------------------------------------------------------------------------
// Boas-vindas
// ---------------------------------------------------------------------------

registerSource({
  id: 'boas_vindas',
  label: 'Boas-vindas ao paciente novo',
  group: 'relacionamento',
  hint: 'Dispara um tempo depois do cadastro. Uma vez por paciente, para sempre.',
  paramsSchema: antecedenciaSchema(0, 30 * MINUTOS_POR_DIA),
  fields: [
    {
      name: 'antecedenciaMin',
      label: 'Quanto tempo depois do cadastro',
      kind: 'duration',
      min: 0,
      max: 30 * MINUTOS_POR_DIA,
      defaultValue: 1 * MINUTOS_POR_DIA,
      hint: 'Em horas, a boas-vindas chega enquanto a pessoa ainda lembra de ter se cadastrado.',
    },
  ],
  variables: [],

  isAnchored: (p) => ancorada(p),

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const antecedenciaMin = lerAntecedencia(ctx.params)
    const linhas = await cadastradosEntre(
      ctx,
      ancorada(ctx.params)
        ? janelaAncorada(ctx, antecedenciaMin, 'depois')
        : janelaDoDia(addDias(ctx.today, -emDias(antecedenciaMin)), ctx.timezone),
    )

    return linhas.map((p) => ({
      patientId: p.id,
      /**
       * Chave FIXA, e é o único lugar da feature onde isso é certo: boas-vindas
       * acontece uma vez na vida do cadastro. Usar a data faria a mensagem
       * repetir se a clínica trocasse o intervalo depois — o mesmo
       * paciente cairia numa janela nova e receberia boas-vindas de novo, meses
       * depois de já ser paciente antigo.
       */
      occurrenceKey: 'boas-vindas',
      variables: {},
    }))
  },
})

// ---------------------------------------------------------------------------
// Aniversário de cadastro
// ---------------------------------------------------------------------------

registerSource({
  id: 'aniversario_cadastro',
  label: 'Aniversário de cadastro na clínica',
  group: 'relacionamento',
  hint: 'Dispara na data em que o paciente completa mais um ano de casa. Uma vez por ano.',
  paramsSchema: z.object({}).strict(),
  fields: [],
  variables: ['anos', 'desde'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const [ano, mes, dia] = ctx.today.split('-') as [string, string, string]

    /**
     * Os aniversários possíveis são vinte janelas de um dia — uma por ano de
     * casa —, e elas vão numa consulta só, não em vinte.
     *
     * A alternativa seria varrer a base e comparar mês e dia em memória, e ela é
     * pior de duas formas: paga o custo proporcional ao tamanho da clínica em
     * vez de ao número de aniversariantes, e joga fora o índice de `created_at`.
     *
     * 29 de fevereiro em ano comum simplesmente não casa com janela nenhuma, e
     * isso é o comportamento certo: quem se cadastrou num 29/02 comemora no
     * próximo 29/02, como no calendário civil.
     */
    const janelas: string[] = []
    const porInicio = new Map<string, { anos: number; data: string }>()
    for (let anosAtras = 1; anosAtras <= 20; anosAtras++) {
      const aniversario = `${Number(ano) - anosAtras}-${mes}-${dia}`
      const { de, ate } = janelaDoDia(aniversario, ctx.timezone)
      janelas.push(`and(created_at.gte.${de},created_at.lt.${ate})`)
      porInicio.set(de, { anos: anosAtras, data: aniversario })
    }

    const linhas = await pageAll<{ id: string; created_at: string }>(
      (from, to) =>
        ctx.supabase
          .from('patients')
          .select('id, created_at')
          .eq('tenant_id', ctx.tenantId)
          .eq('status', 'ativo')
          .eq('automations_opt_in', true)
          .is('anonymized_at', null)
          .not('phone_enc', 'is', null)
          .or(janelas.join(','))
          .order('id')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'aniversario_cadastro',
    )

    const out: SourceCandidate[] = []
    for (const p of linhas) {
      // Descobre a qual janela a linha pertence comparando o instante, não
      // recortando a string: `created_at` volta com o fuso do banco, e cortar
      // "os dez primeiros caracteres" erraria o ano de quem se cadastrou depois
      // das 21h em São Paulo.
      const t = Date.parse(p.created_at)
      let achou: { anos: number; data: string } | null = null
      for (const [de, info] of porInicio) {
        const inicio = Date.parse(de)
        if (t >= inicio && t < inicio + 86_400_000) {
          achou = info
          break
        }
      }
      if (!achou) continue

      out.push({
        patientId: p.id,
        // O ano corrente na chave: a mesma pessoa faz aniversário de novo no
        // ano que vem.
        occurrenceKey: ano,
        variables: { anos: String(achou.anos), desde: dataCivilBr(achou.data) },
      })
    }
    return out
  },
})
