/**
 * Feature 017 — Landing pública do link de agendamento.
 *
 * Server component. Resolve tenant via slug (sem auth). Lista médicos
 * publicados. Cada card linka para /agendar/[slug]/horarios?doctor_id=X.
 */

import { notFound } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { resolveTenantBySlug } from '@/lib/core/public-booking/resolve-tenant'
import { listPublishedDoctors } from '@/lib/core/public-booking/list-published'
import { DoctorList } from '@/components/public-booking/doctor-list'

export const dynamic = 'force-dynamic'

export default async function AgendarSlugPage({
  params,
}: {
  params: { slug: string }
}) {
  const supabase = createSupabaseServiceClient()
  const tenant = await resolveTenantBySlug(supabase, params.slug)
  if (!tenant) notFound()

  const doctors = await listPublishedDoctors(supabase, tenant.tenantId)

  return (
    <div className="space-y-6">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          {tenant.displayName}
        </h1>
        {tenant.addressLine && (
          <p className="text-sm text-slate-500">{tenant.addressLine}</p>
        )}
        {tenant.phone && (
          <p className="text-sm text-slate-500">Contato: {tenant.phone}</p>
        )}
      </header>

      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">
          Escolha um profissional
        </h2>
        {doctors.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nenhum profissional disponível no momento. Entre em contato com a clínica.
          </p>
        ) : (
          <DoctorList slug={params.slug} doctors={doctors} />
        )}
      </div>

      <footer className="text-center text-xs text-slate-400">
        <p>
          Ao agendar você aceita nossa{' '}
          <a
            href={`/agendar/${params.slug}/privacidade`}
            className="text-link underline-offset-2 hover:underline"
          >
            política de privacidade
          </a>
          .
        </p>
      </footer>
    </div>
  )
}
