/**
 * Feature 030 — /paciente/[slug] — login do portal do paciente (US1).
 *
 * Server component público. Resolve a clínica pelo slug (server-side; o
 * portal não exige public_booking_enabled). Sessão válida para esta
 * clínica → direto ao painel.
 */

import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { resolvePortalClinicBySlug } from '@/lib/core/patient-portal/login'
import {
  PATIENT_SESSION_COOKIE_NAME,
  verifyPatientSessionCookie,
} from '@/lib/core/patient-portal/session'
import { PatientLoginForm } from './login-form'

export const dynamic = 'force-dynamic'

export default async function PacienteLoginPage({
  params,
  searchParams,
}: {
  params: { slug: string }
  searchParams: { sessao?: string }
}) {
  const supabase = createSupabaseServiceClient()
  const clinic = await resolvePortalClinicBySlug(supabase, params.slug)
  if (!clinic) notFound()

  const session = verifyPatientSessionCookie(
    cookies().get(PATIENT_SESSION_COOKIE_NAME)?.value,
  )
  if (session && session.tenantId === clinic.tenantId) {
    redirect(`/paciente/${params.slug}/painel`)
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <header className="space-y-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {clinic.displayName}
        </h1>
        <p className="text-sm text-slate-500">
          Portal do paciente — acompanhe sua evolução e seus atendimentos.
        </p>
      </header>

      {searchParams.sessao === 'expirada' ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-800">
          Sua sessão expirou. Entre novamente para continuar.
        </p>
      ) : null}

      <PatientLoginForm slug={params.slug} />

      <footer className="text-center text-xs text-slate-400">
        <p>
          Em caso de dúvida sobre seus dados de acesso, entre em contato com a
          clínica.
        </p>
      </footer>
    </div>
  )
}
