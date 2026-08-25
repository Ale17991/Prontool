/**
 * Feature 017 — Landing pública do link de agendamento.
 *
 * Server component. Resolve tenant via slug (sem auth). Lista médicos
 * publicados. Cada card linka para /agendar/[slug]/horarios?doctor_id=X.
 * Com um único profissional publicado, a etapa é pulada por redirect.
 */

import { notFound, redirect } from 'next/navigation'
import { ShieldCheck, Sparkles } from 'lucide-react'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { resolveTenantBySlug } from '@/lib/core/public-booking/resolve-tenant'
import { listPublishedDoctors } from '@/lib/core/public-booking/list-published'
import { ClinicHero } from '@/components/public-booking/clinic-hero'
import { DoctorList } from '@/components/public-booking/doctor-list'

export const dynamic = 'force-dynamic'

export default async function AgendarSlugPage({ params }: { params: { slug: string } }) {
  const supabase = createSupabaseServiceClient()
  const tenant = await resolveTenantBySlug(supabase, params.slug)
  if (!tenant) notFound()

  const doctors = await listPublishedDoctors(supabase, tenant.tenantId)

  // Um profissional publicado só: a escolha não existe, e "sem preferência"
  // é a mesma pessoa por outro nome. Vai direto aos horários — a tela de lá
  // leva o hero da clínica, porque passa a ser a porta de entrada do link.
  if (doctors.length === 1) {
    redirect(`/agendar/${params.slug}/horarios?doctor_id=${doctors[0]!.doctorId}`)
  }

  return (
    <div className="space-y-6">
      <ClinicHero
        displayName={tenant.displayName}
        addressLine={tenant.addressLine}
        phone={tenant.phone}
      />

      {/* Escolha de profissional */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </span>
          <h2 className="text-lg font-bold text-foreground">Escolha um profissional</h2>
        </div>

        {doctors.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhum profissional disponível no momento.
              <br />
              Entre em contato com a clínica{tenant.phone ? ` pelo ${tenant.phone}` : ''}.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <a
              href={`/agendar/${params.slug}/horarios?doctor_id=any`}
              className="group flex items-center gap-4 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4 transition hover:border-primary hover:bg-primary/10"
            >
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-primary/15 text-primary">
                <Sparkles className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-foreground">
                  Sem preferência de profissional
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">
                  Atenderei com quem tiver a melhor disponibilidade.
                </span>
              </span>
              <span className="flex-none text-sm font-medium text-primary transition group-hover:translate-x-0.5">
                Ver horários →
              </span>
            </a>

            <DoctorList slug={params.slug} doctors={doctors} />
          </div>
        )}
      </section>

      {/* Rodapé de confiança */}
      <footer className="flex flex-col items-center gap-1 text-center text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" />
          Seus dados são tratados com segurança.
        </span>
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
