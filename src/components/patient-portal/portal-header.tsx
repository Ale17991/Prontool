import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, CalendarClock } from 'lucide-react'
import { Card } from '@/components/ui/card'

/**
 * Feature 032/057 — cabeçalho do portal do paciente.
 *
 * Usa o `Card` e os TOKENS do design system, não cor escrita na mão. Isso não é
 * só consistência: é o que permite a clínica escolher a própria paleta mais
 * tarde, porque trocar `--primary` no layout do portal alcança tudo que fala
 * essa língua. Cor fixa em classe (`bg-lime-100`, `text-slate-700`) seria
 * invisível para qualquer tema.
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
   * Uma LINHA, não um bloco: é o que mais traz paciente a um portal de clínica,
   * mas a tela inicial existe para ser curta. Ausente ⇒ o cabeçalho não muda de
   * forma e não anuncia a ausência.
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
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {logoUrl ? (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt={clinicName} className="h-full w-full object-contain p-0.5" />
            </span>
          ) : null}
          <p className="truncate text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {clinicName}
          </p>
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>

      <div className="mt-4">
        {backHref ? (
          <Link
            href={backHref}
            className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar para o início
          </Link>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        {nextAppointment ? (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
            <CalendarClock className="h-3.5 w-3.5" />
            Sua próxima consulta: {nextAppointment}
          </p>
        ) : null}
      </div>
    </Card>
  )
}
