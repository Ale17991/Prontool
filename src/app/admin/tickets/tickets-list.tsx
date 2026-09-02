'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { KIND_LABELS, type SupportTicketKind } from '@/lib/core/support-tickets/schema'
import type { SupportTicketRow } from '@/lib/core/support-tickets/list'
import { cn } from '@/lib/utils'

/**
 * Tickets de todas as clínicas.
 *
 * A DESCRIÇÃO é o conteúdo, não um detalhe: a linha mostra o título e um
 * trecho, e abrir revela o texto inteiro preservando as quebras de linha de
 * quem escreveu. Truncar sem poder expandir devolveria a pessoa ao e-mail, que
 * é o que esta tela existe para substituir.
 */

const TIPO_COR: Record<SupportTicketKind, string> = {
  bug: 'bg-destructive/10 text-destructive',
  suggestion: 'bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]',
  support: 'bg-slate-100 text-slate-600',
}

/** Só o que exige ação aparece colorido; o resto não deve competir por atenção. */
const CRM_ROTULO: Record<string, { texto: string; classe: string }> = {
  enviado: { texto: 'no CRM', classe: 'text-success-text' },
  sem_config: { texto: 'CRM desligado', classe: 'text-slate-400' },
  sem_contato: { texto: 'sem e-mail/telefone', classe: 'text-[hsl(var(--warning-foreground))]' },
  upsert_falhou: { texto: 'falhou no contato', classe: 'text-destructive' },
  nota_falhou: { texto: 'falhou na nota', classe: 'text-destructive' },
  erro: { texto: 'erro', classe: 'text-destructive' },
}

type Filtro = 'todos' | 'problemas' | SupportTicketKind

export function TicketsList({ tickets }: { tickets: SupportTicketRow[] }) {
  const [aberto, setAberto] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('todos')

  const visiveis = useMemo(() => {
    if (filtro === 'todos') return tickets
    if (filtro === 'problemas') {
      return tickets.filter(
        (t) => t.crmStatus !== null && t.crmStatus !== 'enviado' && t.crmStatus !== 'sem_config',
      )
    }
    return tickets.filter((t) => t.kind === filtro)
  }, [tickets, filtro])

  const comProblema = tickets.filter(
    (t) => t.crmStatus !== null && t.crmStatus !== 'enviado' && t.crmStatus !== 'sem_config',
  ).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['todos', `Todos (${tickets.length})`],
            ['bug', KIND_LABELS.bug],
            ['suggestion', KIND_LABELS.suggestion],
            ['support', KIND_LABELS.support],
            ['problemas', `Não foram ao CRM (${comProblema})`],
          ] as Array<[Filtro, string]>
        ).map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            onClick={() => setFiltro(valor)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              filtro === valor
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50',
              valor === 'problemas' && comProblema > 0 && filtro !== valor && 'text-destructive',
            )}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Nenhum ticket aqui.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {visiveis.map((t) => {
            const expandido = aberto === t.id
            const crm = t.crmStatus ? CRM_ROTULO[t.crmStatus] : null
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setAberto(expandido ? null : t.id)}
                  className="flex w-full items-start gap-3 p-4 text-left hover:bg-slate-50"
                >
                  {expandido ? (
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  ) : (
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
                          TIPO_COR[t.kind],
                        )}
                      >
                        {KIND_LABELS[t.kind]}
                      </span>
                      <span className="font-medium text-slate-900">{t.title}</span>
                    </div>
                    {!expandido && (
                      <p className="mt-1 line-clamp-1 text-sm text-slate-500">{t.description}</p>
                    )}
                    <p className="mt-1 text-xs text-slate-400">
                      {t.clinica} · {t.userEmail ?? '—'} · {formatarData(t.createdAt)}
                      {crm && (
                        <span className={cn('ml-2 font-medium', crm.classe)}>{crm.texto}</span>
                      )}
                    </p>
                  </div>
                </button>

                {expandido && (
                  <div className="space-y-3 border-t border-slate-100 bg-slate-50 px-4 py-4 pl-11">
                    {/* whitespace-pre-wrap: as quebras de linha são de quem escreveu. */}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                      {t.description}
                    </p>

                    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                      <Campo rotulo="Clínica" valor={t.clinica} />
                      <Campo
                        rotulo="Quem abriu"
                        valor={`${t.userEmail ?? '—'}${t.userRole ? ` (${t.userRole})` : ''}`}
                      />
                      <Campo rotulo="Situação" valor={t.status} />
                      <Campo rotulo="Ticket" valor={t.id} mono />
                      {t.pageUrl && (
                        <div className="sm:col-span-2">
                          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                            Tela
                          </dt>
                          <dd>
                            <a
                              href={t.pageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 break-all font-mono text-[11px] text-primary hover:underline"
                            >
                              {t.pageUrl}
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          </dd>
                        </div>
                      )}
                    </dl>

                    {t.crmStatus && (
                      <div className="rounded-md border border-slate-200 bg-white p-3">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                          {t.crmStatus === 'enviado' ? (
                            <Check className="h-3.5 w-3.5 text-success-text" />
                          ) : (
                            <AlertTriangle className="h-3.5 w-3.5 text-[hsl(var(--warning-foreground))]" />
                          )}
                          CRM: {crm?.texto ?? t.crmStatus}
                        </p>
                        {t.crmDetail && Object.keys(t.crmDetail).length > 0 && (
                          <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-2 font-mono text-[10px] leading-relaxed text-slate-100">
                            {JSON.stringify(t.crmDetail, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Campo({ rotulo, valor, mono }: { rotulo: string; valor: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{rotulo}</dt>
      <dd className={cn('text-slate-700', mono && 'break-all font-mono text-[11px]')}>{valor}</dd>
    </div>
  )
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
