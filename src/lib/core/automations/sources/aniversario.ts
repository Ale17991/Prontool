/**
 * Feature 056 — fonte: aniversário do paciente.
 *
 * A mais simples das cinco, e por isso a escolhida para o MVP: não depende de
 * agenda nem de checklist, e o dado já existe no cadastro.
 *
 * O que ela tem de delicado é a data. `birth_date` é PII cifrada, então não dá
 * para comparar dia e mês em SQL — a decifra acontece por RPC, paciente a
 * paciente. Para não decifrar a base inteira todo dia, a enumeração parte dos
 * pacientes ativos com `automations_opt_in` ligado, que é um conjunto bem menor
 * que "todos".
 *
 * QUATRO MOMENTOS, E POR QUE NÃO É SÓ "NO DIA"
 *
 * Parabéns no dia é o uso óbvio, mas não é o único que a clínica faz do
 * aniversário. Mandar dias ANTES serve para convidar ("seu mês é agora, vamos
 * marcar?"), dias DEPOIS evita concorrer com as dezenas de mensagens que a
 * pessoa recebe no próprio dia, e o INÍCIO DO MÊS existe porque muita clínica
 * roda promoção que vale o mês do aniversário inteiro — nesse caso avisar no dia
 * 15 é entregar metade do benefício.
 */

import { z } from 'zod'
import { registerSource } from './registry'
import { addDias, pageAll } from './shared'
import type { EnumerateContext, SourceCandidate } from '../types'

const paramsSchema = z
  .object({
    quando: z.enum(['no_dia', 'antes', 'depois', 'inicio_do_mes']).default('no_dia'),
    dias: z.number().int().min(1).max(60).default(7),
  })
  .strict()

/** `YYYY-MM-DD` → `MM-DD`, para comparar aniversário sem o ano. */
function monthDay(isoDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim())
  return m ? `${m[2]}-${m[3]}` : null
}

/** `YYYY-MM-DD` → `MM`. */
function month(isoDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim())
  return m ? (m[2] as string) : null
}

registerSource({
  id: 'aniversario',
  label: 'Aniversário do paciente',
  group: 'relacionamento',
  hint: 'Dispara uma vez por ano: no dia, antes, depois ou no primeiro dia do mês do aniversário.',
  paramsSchema,
  fields: [
    {
      name: 'quando',
      label: 'Quando enviar',
      kind: 'select',
      defaultValue: 'no_dia',
      options: [
        { value: 'no_dia', label: 'No dia do aniversário' },
        { value: 'antes', label: 'Alguns dias antes' },
        { value: 'depois', label: 'Alguns dias depois' },
        { value: 'inicio_do_mes', label: 'No primeiro dia do mês do aniversário' },
      ],
    },
    {
      name: 'dias',
      label: 'Quantos dias',
      kind: 'number',
      min: 1,
      max: 60,
      defaultValue: 7,
      showWhen: { field: 'quando', equals: ['antes', 'depois'] },
      hint: 'Contado em dias civis a partir da data de nascimento.',
    },
  ],
  variables: ['data_aniversario'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
    if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY required')

    const { quando = 'no_dia', dias = 7 } = ctx.params as {
      quando?: 'no_dia' | 'antes' | 'depois' | 'inicio_do_mes'
      dias?: number
    }

    /**
     * A data que o aniversário do paciente precisa ter para ele entrar HOJE.
     *
     * Para avisar 7 dias ANTES, hoje é 10/03 e o aniversário procurado é 17/03 —
     * o deslocamento é somado ao dia de hoje, não subtraído. Confundir o sentido
     * manda a mensagem uma semana depois de passar, todos os anos.
     */
    const alvo =
      quando === 'antes'
        ? addDias(ctx.today, dias)
        : quando === 'depois'
          ? addDias(ctx.today, -dias)
          : ctx.today

    const alvoMonthDay = monthDay(alvo)
    const alvoMes = month(ctx.today)
    if (!alvoMonthDay || !alvoMes) return []

    // No modo "início do mês", só o primeiro dia do mês produz candidatos. Nos
    // outros 30 dias não há o que fazer, e sair antes evita decifrar a base
    // inteira à toa — que é o custo caro desta fonte.
    if (quando === 'inicio_do_mes' && !ctx.today.endsWith('-01')) return []

    // Só pacientes que poderiam receber. Filtrar aqui é o que evita decifrar a
    // base inteira todos os dias — e paciente anonimizado sai por aqui também
    // (FR-017), sem precisar de checagem extra adiante.
    //
    // Pagina: o PostgREST corta em 1.000 linhas sem avisar, e numa clínica com
    // 1.200 pacientes os 200 do fim nunca fariam aniversário.
    const linhas = await pageAll<{ id: string }>(
      (from, to) =>
        ctx.supabase
          .from('patients')
          .select('id')
          .eq('tenant_id', ctx.tenantId)
          .eq('status', 'ativo')
          .eq('automations_opt_in', true)
          .is('anonymized_at', null)
          .not('birth_date_enc', 'is', null)
          .not('phone_enc', 'is', null)
          .order('id')
          .range(from, to) as unknown as PromiseLike<{
          data: unknown
          error: { message: string } | null
        }>,
      'aniversario',
    )

    const out: SourceCandidate[] = []
    for (const row of linhas) {
      const dec = await ctx.supabase.rpc('get_patient_for_tenant', {
        p_tenant_id: ctx.tenantId,
        p_patient_id: row.id,
        p_key: key,
      })
      if (dec.error || !dec.data) continue
      const p = (Array.isArray(dec.data) ? dec.data[0] : dec.data) as {
        full_name: string | null
        birth_date: string | null
      } | null
      if (!p?.birth_date || !p.full_name) continue

      const nascimento = monthDay(p.birth_date)
      if (!nascimento) continue
      if (quando === 'inicio_do_mes') {
        if (nascimento.slice(0, 2) !== alvoMes) continue
      } else if (nascimento !== alvoMonthDay) continue

      out.push({
        patientId: row.id,
        /**
         * Uma vez por ANIVERSÁRIO, e a chave é o ano do aniversário celebrado —
         * não a data em que a mensagem sai.
         *
         * A diferença aparece quando a clínica muda o parâmetro no meio do ano:
         * com a data do envio na chave, quem já recebeu "no dia" receberia de
         * novo ao ser trocado para "7 dias depois", porque seria outra data.
         * Com o ano do aniversário, o segundo envio é recusado pelo banco.
         *
         * O ano vem do ALVO e não de hoje: avisar 5 dias antes de um
         * aniversário de 2 de janeiro acontece em dezembro, e o aniversário
         * celebrado é o do ano seguinte.
         */
        occurrenceKey:
          quando === 'inicio_do_mes' ? ctx.today.slice(0, 7) : (alvo.slice(0, 4) as string),
        variables: {
          paciente: p.full_name,
          clinica: ctx.clinicName,
          data_aniversario: `${nascimento.slice(3, 5)}/${nascimento.slice(0, 2)}`,
        },
      })
    }
    return out
  },
})
