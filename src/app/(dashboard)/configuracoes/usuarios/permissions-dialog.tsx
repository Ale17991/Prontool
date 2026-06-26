'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  ALL_ACTIONS,
  PROTECTED_ACTIONS,
  SENSITIVE_ACTIONS,
  can,
  type Action,
} from '@/lib/auth/rbac'
import { labelForRole, type TeamMember } from '@/lib/core/team/types'
import type { TenantRole } from '@/lib/db/types'

type Tri = 'inherit' | 'grant' | 'deny'

interface Props {
  target: TeamMember
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

const PROTECTED = new Set<string>(PROTECTED_ACTIONS as readonly string[])
const SENSITIVE = new Set<string>(SENSITIVE_ACTIONS as readonly string[])

// Ações overridáveis agrupadas pelo prefixo (parte antes do ponto).
const GROUPS: Array<{ key: string; actions: Action[] }> = (() => {
  const overridable = (ALL_ACTIONS as Action[]).filter((a) => !PROTECTED.has(a))
  const byPrefix = new Map<string, Action[]>()
  for (const a of overridable) {
    const k = a.split('.')[0] ?? a
    byPrefix.set(k, [...(byPrefix.get(k) ?? []), a])
  }
  return [...byPrefix.entries()].map(([key, actions]) => ({ key, actions }))
})()

export function PermissionsDialog({ target, onOpenChange, onSuccess }: Props) {
  const [role, setRole] = useState<TenantRole>(target.role)
  const [state, setState] = useState<Record<string, Tri>>({})
  const [loaded, setLoaded] = useState<Record<string, Tri>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const res = await fetch(`/api/configuracoes/usuarios/${target.userId}/permissions`)
        const body = (await res.json().catch(() => ({}))) as {
          role?: TenantRole
          overrides?: Array<{ action: string; effect: 'grant' | 'deny' }>
        }
        if (!active) return
        if (body.role) setRole(body.role)
        const init: Record<string, Tri> = {}
        for (const o of body.overrides ?? []) init[o.action] = o.effect
        setLoaded(init)
        setState(init)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [target.userId])

  const changes = useMemo(() => {
    const out: Array<{ action: Action; effect: Tri }> = []
    for (const a of ALL_ACTIONS as Action[]) {
      if (PROTECTED.has(a)) continue
      const cur = state[a] ?? 'inherit'
      const prev = loaded[a] ?? 'inherit'
      if (cur !== prev) out.push({ action: a, effect: cur })
    }
    return out
  }, [state, loaded])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (changes.length === 0) {
      onOpenChange(false)
      return
    }
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/configuracoes/usuarios/${target.userId}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes }),
      })
      if (res.ok) {
        onSuccess()
        return
      }
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      setError(body.error?.message ?? `HTTP ${res.status}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function setTri(action: Action, tri: Tri) {
    if (tri === 'grant' && SENSITIVE.has(action)) {
      const ok =
        typeof window === 'undefined' ||
        window.confirm(
          `"${action}" é uma permissão sensível. Conceder dá ao usuário uma capacidade além do papel "${labelForRole(role)}". Confirmar?`,
        )
      if (!ok) return
    }
    setState((s) => ({ ...s, [action]: tri }))
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Permissões — {target.fullName ?? target.email}</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-slate-500">
          Papel base: <strong>{labelForRole(role)}</strong>. Ajuste por ação: <em>Herdar</em> usa o papel;
          <em> Conceder</em> adiciona; <em>Revogar</em> retira (revogação sempre vence).
        </p>

        {loading ? (
          <p className="py-8 text-center text-sm text-slate-500">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Carregando…
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-4">
              {GROUPS.map((g) => (
                <div key={g.key}>
                  <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">{g.key}</p>
                  <div className="space-y-1">
                    {g.actions.map((a) => {
                      const base = can(role, a)
                      const cur = state[a] ?? 'inherit'
                      return (
                        <div key={a} className="flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-slate-50">
                          <span className="font-mono text-[11px] text-slate-700">
                            {a}
                            <span className="ml-2 text-[10px] text-slate-400">
                              {base ? '(no papel)' : '(fora do papel)'}
                            </span>
                            {SENSITIVE.has(a) ? (
                              <ShieldAlert className="ml-1 inline h-3 w-3 text-[hsl(var(--warning-foreground))]" />
                            ) : null}
                          </span>
                          <select
                            value={cur}
                            onChange={(e) => setTri(a, e.target.value as Tri)}
                            className="h-7 rounded-md border border-input bg-background px-2 text-[11px]"
                          >
                            <option value="inherit">Herdar ({base ? 'permite' : 'nega'})</option>
                            <option value="grant">Conceder</option>
                            <option value="deny">Revogar</option>
                          </select>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
              Ações financeiras-críticas ({[...PROTECTED].join(', ')}) são protegidas e não podem ter override —
              continuam atadas ao papel.
            </p>

            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">{changes.length} alteração(ões)</span>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={busy || changes.length === 0}>
                  {busy ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                  Salvar
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
