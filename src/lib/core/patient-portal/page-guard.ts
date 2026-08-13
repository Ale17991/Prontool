import { notFound, redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { resolvePortalClinicBySlug, type PortalClinic } from './login'
import {
  PATIENT_SESSION_COOKIE_NAME,
  verifyPatientSessionCookie,
  type PatientSessionPayload,
} from './session'
import { listEnabledPortalSections, type PortalSectionKey } from './sections'
import { hashIpForPatientPortal, logPatientAccess } from './audit'

/**
 * Porta única de toda página do portal do paciente — mesmo papel que
 * `printouts/guard.ts` cumpre nos impressos (054).
 *
 * O portal deixou de ser uma tela só: a home mostra metas e hábitos, e cada
 * outra área virou página própria. Sem esta porta, a checagem de sessão e o
 * gate de seção ficariam copiados em sete arquivos — e a oitava página nasceria
 * sem um dos dois.
 *
 * O `section` NÃO é enfeite de UI: seção desligada pela clínica (ou não
 * liberada pelo plano) tem que barrar a URL digitada à mão, senão o gate seria
 * só o card da home. É a mesma regra que a 051/056 aplicam no motor e não só na
 * tela. Barrar devolve à home, nunca 404: a página existe, o que não existe é a
 * permissão de vê-la — e 404 aqui só confundiria quem tem o link antigo.
 */

export interface PortalPageContext {
  supabase: SupabaseClient<Database>
  clinic: PortalClinic
  session: PatientSessionPayload
  /** Seções visíveis a ESTE paciente (plano da clínica × override × default). */
  enabled: Set<PortalSectionKey>
  slug: string
}

export interface OpenPortalPageOptions {
  /** Seção exigida por esta página. Desligada ⇒ volta para a home do portal. */
  section?: PortalSectionKey
  /**
   * Rótulo da área para a trilha de acesso. Só a home precisa informar (`home`);
   * as páginas de seção reusam a própria `section`.
   */
  logAs?: string
}

export async function openPortalPage(
  slug: string,
  opts: OpenPortalPageOptions = {},
): Promise<PortalPageContext> {
  const supabase = createSupabaseServiceClient()
  const clinic = await resolvePortalClinicBySlug(supabase, slug)
  if (!clinic) notFound()

  const rawCookie = cookies().get(PATIENT_SESSION_COOKIE_NAME)?.value
  const session = verifyPatientSessionCookie(rawCookie)
  if (!session || session.tenantId !== clinic.tenantId) {
    redirect(`/paciente/${slug}${rawCookie ? '?sessao=expirada' : ''}`)
  }

  const ent = await getTenantEntitlements(supabase, session.tenantId)
  const enabledList = await listEnabledPortalSections(supabase, session.tenantId, {
    hasModule: (m) => ent.hasModule(m),
  })
  const enabled = new Set(enabledList)

  // Trilha LGPD (FR-007): cada página aberta é um acesso a dado de saúde. A
  // `action` continua sendo `view` — o CHECK da tabela só conhece
  // login_ok/login_fail/view/habit_mark —, e QUAL área foi aberta vai na coluna
  // `section` (0202). São duas perguntas independentes: o que a pessoa fez e
  // onde ela estava.
  const h = headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown'
  await logPatientAccess({
    supabase,
    tenantId: session.tenantId,
    patientId: session.patientId,
    action: 'view',
    ipHash: hashIpForPatientPortal(ip, session.tenantId),
    userAgent: h.get('user-agent'),
    section: opts.logAs ?? opts.section ?? 'home',
  })

  if (opts.section && !enabled.has(opts.section)) {
    redirect(`/paciente/${slug}/painel`)
  }

  return { supabase, clinic, session, enabled, slug }
}

// Datas do portal moram em `format.ts` — importar `next/navigation` (que este
// arquivo faz) só para formatar data arrastaria o roteador para dentro de
// qualquer teste de unidade que precisasse de uma data.
export { todayInClinicTz, brDayInClinicTz, brDayTimeInClinicTz } from './format'
