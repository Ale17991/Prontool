'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'
import { setSupportTenantAccessAction } from './actions'

export interface SupportUser {
  userId: string
  email: string
  assignedTenantIds: string[]
}

interface TenantOption {
  tenantId: string
  name: string
  slug: string
}

export function SupportAccess({
  supports,
  tenants,
}: {
  supports: SupportUser[]
  tenants: TenantOption[]
}) {
  if (supports.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
        Nenhum usuário de suporte. Crie a conta no Supabase e insira em{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">platform_admins</code> com{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">is_super = false</code>; ele
        aparece aqui para você atribuir as clínicas.
      </p>
    )
  }
  return (
    <div className="space-y-3">
      {supports.map((s) => (
        <SupportRow key={s.userId} support={s} tenants={tenants} />
      ))}
    </div>
  )
}

function SupportRow({ support, tenants }: { support: SupportUser; tenants: TenantOption[] }) {
  const [assigned, setAssigned] = useState<Set<string>>(new Set(support.assignedTenantIds))
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function toggle(tenantId: string, on: boolean) {
    // Otimista; reverte em erro.
    setAssigned((prev) => {
      const next = new Set(prev)
      if (on) next.add(tenantId)
      else next.delete(tenantId)
      return next
    })
    startTransition(async () => {
      const res = await setSupportTenantAccessAction({
        supportUserId: support.userId,
        tenantId,
        on,
      })
      if (!res.ok) {
        setAssigned((prev) => {
          const next = new Set(prev)
          if (on) next.delete(tenantId)
          else next.add(tenantId)
          return next
        })
        setFeedback({ kind: 'error', msg: res.error ?? 'Erro ao atualizar acesso.' })
      } else {
        setFeedback({ kind: 'ok', msg: 'Acesso atualizado.' })
      }
    })
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-bold text-slate-900">{support.email}</p>
      <p className="mb-3 text-[11px] text-slate-400">
        {assigned.size} clínica{assigned.size === 1 ? '' : 's'} atribuída{assigned.size === 1 ? '' : 's'}
      </p>
      <div className="flex flex-wrap gap-2">
        {tenants.map((t) => {
          const on = assigned.has(t.tenantId)
          return (
            <button
              key={t.tenantId}
              type="button"
              disabled={pending}
              onClick={() => toggle(t.tenantId, !on)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50',
                on
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              )}
              title={t.slug}
            >
              {t.name}
            </button>
          )
        })}
      </div>
      {feedback ? (
        <p
          className={cn(
            'mt-2 text-[11px] font-medium',
            feedback.kind === 'ok' ? 'text-success-strong' : 'text-destructive',
          )}
        >
          {feedback.msg}
        </p>
      ) : null}
    </div>
  )
}
