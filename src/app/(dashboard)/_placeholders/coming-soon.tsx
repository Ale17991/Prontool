import Link from 'next/link'
import type { ComponentType } from 'react'
import { ArrowRight, Construction } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export interface ComingSoonProps {
  title: string
  subtitle: string
  icon: ComponentType<{ className?: string }>
  description: string
  plannedScope: string[]
  dependsOn?: string[]
  relatedLinks?: Array<{ href: string; label: string }>
}

export function ComingSoon({
  title,
  subtitle,
  icon: Icon,
  description,
  plannedScope,
  dependsOn,
  relatedLinks,
}: ComingSoonProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        <Badge variant="warning" className="shrink-0">
          <Construction className="mr-1 h-3 w-3" /> Em breve
        </Badge>
      </div>

      <Card>
        <CardContent className="p-8">
          <div className="mb-6 inline-flex rounded-2xl border border-blue-100 bg-blue-50 p-4 text-primary">
            <Icon className="h-6 w-6" />
          </div>
          <p className="text-sm leading-relaxed text-slate-600">{description}</p>

          <div className="mt-6 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Escopo planejado
            </p>
            <ul className="space-y-2">
              {plannedScope.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {dependsOn && dependsOn.length > 0 ? (
            <div className="mt-6 space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Depende de
              </p>
              <ul className="space-y-1.5">
                {dependsOn.map((d, idx) => (
                  <li key={idx} className="font-mono text-xs text-slate-500">
                    · {d}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {relatedLinks && relatedLinks.length > 0 ? (
            <div className="mt-8 flex flex-wrap gap-2 border-t border-slate-100 pt-6">
              {relatedLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  {l.label} <ArrowRight className="h-3 w-3" />
                </Link>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
