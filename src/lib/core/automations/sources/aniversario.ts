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
 */

import { z } from 'zod'
import { registerSource } from './registry'
import { pageAll } from './shared'
import type { EnumerateContext, SourceCandidate } from '../types'

const paramsSchema = z.object({}).strict()

/** `YYYY-MM-DD` → `MM-DD`, para comparar aniversário sem o ano. */
function monthDay(isoDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim())
  return m ? `${m[2]}-${m[3]}` : null
}

registerSource({
  id: 'aniversario',
  label: 'Aniversário do paciente',
  group: 'relacionamento',
  hint: 'Dispara no dia do aniversário, uma vez por ano.',
  paramsSchema,
  fields: [],
  variables: [],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
    if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY required')

    const hoje = monthDay(ctx.today)
    if (!hoje) return []

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
      if (monthDay(p.birth_date) !== hoje) continue

      out.push({
        patientId: row.id,
        // Uma vez por aniversário. O ano entra na chave porque a mesma pessoa
        // faz aniversário de novo no ano seguinte.
        occurrenceKey: ctx.today,
        variables: { paciente: p.full_name, clinica: ctx.clinicName },
      })
    }
    return out
  },
})
