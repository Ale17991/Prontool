import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, CalendarClock } from 'lucide-react'

/**
 * Feature 032 — cabeçalho do portal do paciente.
 * Estilo clean e sério, moderno e acolhedor: cartão branco, logo + nome da
 * clínica discretos, saudação com boa hierarquia. Sem gradiente/ruído.
 */
interface Props {
  clinicName: string
  logoUrl: string | null
  title: string
  subtitle?: string
  /** Conteúdo à direita (ex.: botão sair). */
  right?: ReactNode
  /**
   * Volta para a home do portal. Presente só nas páginas de seção — é o único
   * caminho de volta que elas têm, já que o portal não tem menu fixo.
   */
  backHref?: string
  /**
   * Feature 057 — próxima consulta, já formatada ("14/08 às 15h").
   *
   * Uma LINHA, não um bloco: "quando é a minha próxima consulta" é o que mais
   * traz paciente a um portal de clínica, mas a tela inicial existe para ser
   * curta. Ausente ⇒ o cabeçalho não muda de forma e não anuncia a ausência —
   * dizer "você não tem consulta marcada" a quem acabou de sair de uma é ruído.
   */
  nextAppointment?: string | null
}

export function PortalHeader({
  clinicName,
  logoUrl,
  title,
  subtitle,
  right,
  backHref,
  nextAppointment,
}: Props) {
  return (
    <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {logoUrl ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt={clinicName} className="h-full w-full object-contain p-0.5" />
            </span>
          ) : null}
          <p className="truncate text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            {clinicName}
          </p>
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>

      <div className="mt-4">
        {backHref ? (
          <Link
            href={backHref}
            className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar para o início
          </Link>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
        {nextAppointment ? (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
            <CalendarClock className="h-3.5 w-3.5 text-slate-400" />
            Sua próxima consulta: {nextAppointment}
          </p>
        ) : null}
      </div>
    </header>
  )
}
