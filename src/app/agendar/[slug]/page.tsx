/**
 * Feature 017 — Landing pública do link de agendamento.
 *
 * Server component. Resolve tenant via slug (sem auth). Lista médicos
 * publicados. Cada card linka para /agendar/[slug]/horarios?doctor_id=X.
 */

import { notFound } from 'next/navigation'
import { CalendarCheck, MapPin, Phone, ShieldCheck, Sparkles } from 'lucide-react'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { resolveTenantBySlug } from '@/lib/core/public-booking/resolve-tenant'
import { listPublishedDoctors } from '@/lib/core/public-booking/list-published'
import { DoctorList } from '@/components/public-booking/doctor-list'

export const dynamic = 'force-dynamic'

/** Iniciais da clínica para o avatar do hero (até 2 letras). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export default async function AgendarSlugPage({ params }: { params: { slug: string } }) {
  const supabase = createSupabaseServiceClient()
  const tenant = await resolveTenantBySlug(supabase, params.slug)
  if (!tenant) notFound()

  const doctors = await listPublishedDoctors(supabase, tenant.tenantId)

  return (
    <div className="space-y-6">
      {/* Hero da clínica */}
      <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0AB9C7] via-[#1C7FB8] to-[#0A6BAA] px-6 py-8 text-white shadow-lg sm:px-8 sm:py-10">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-16 -left-8 h-44 w-44 rounded-full bg-white/5" />
        <div className="relative flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 text-2xl font-black backdrop-blur-sm ring-1 ring-white/30">
            {initials(tenant.displayName)}
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{tenant.displayName}</h1>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-white/85">
              {tenant.addressLine && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {tenant.addressLine}
                </span>
              )}
              {tenant.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" />
                  {tenant.phone}
                </span>
              )}
            </div>
          </div>
          <p className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
            <CalendarCheck className="h-3.5 w-3.5" />
            Agende sua consulta online em poucos cliques
          </p>
        </div>
      </header>

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
