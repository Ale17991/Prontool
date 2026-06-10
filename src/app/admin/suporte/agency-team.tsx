'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldCheck, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  createAgencyUserAction,
  removeAgencyAdminAction,
  setAgencySuperAction,
} from './agency-actions'

export interface AgencyUser {
  userId: string
  email: string
  isSuper: boolean
  isSelf: boolean
}

export function AgencyTeam({ users }: { users: AgencyUser[] }) {
  const router = useRouter()
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function notify(res: { ok: boolean; error?: string }, okMsg = 'Feito.') {
    setFeedback(res.ok ? { kind: 'ok', msg: okMsg } : { kind: 'error', msg: res.error ?? 'Erro.' })
    if (res.ok) router.refresh()
  }

  return (
    <div className="space-y-4">
      <CreateForm pending={pending} run={(fn) => startTransition(fn)} notify={notify} />

      {feedback ? (
        <p
          className={cn(
            'text-xs font-medium',
            feedback.kind === 'ok' ? 'text-success-strong' : 'text-destructive',
          )}
        >
          {feedback.msg}
        </p>
      ) : null}

      <div className="space-y-2">
        {users.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum usuário da agência ainda.</p>
        ) : (
          users.map((u) => (
            <div
              key={u.userId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">
                  {u.email}
                  {u.isSelf ? <span className="ml-1 text-[11px] font-normal text-slate-400">(você)</span> : null}
                </p>
                <span
                  className={cn(
                    'mt-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold',
                    u.isSuper
                      ? 'bg-primary/10 text-primary'
                      : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {u.isSuper ? <ShieldCheck className="h-3 w-3" /> : null}
                  {u.isSuper ? 'Admin geral' : 'Suporte'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || u.isSelf}
                  onClick={() =>
                    startTransition(async () =>
                      notify(
                        await setAgencySuperAction(u.userId, !u.isSuper),
                        u.isSuper ? 'Rebaixado a suporte.' : 'Promovido a admin geral.',
                      ),
                    )
                  }
                >
                  {u.isSuper ? 'Tornar suporte' : 'Tornar admin geral'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending || u.isSelf}
                  className="text-destructive hover:text-destructive"
                  onClick={() =>
                    startTransition(async () =>
                      notify(await removeAgencyAdminAction(u.userId), 'Acesso removido.'),
                    )
                  }
                >
                  Remover
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function CreateForm({
  pending,
  run,
  notify,
}: {
  pending: boolean
  run: (fn: () => Promise<void>) => void
  notify: (res: { ok: boolean; error?: string }, okMsg?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSuper, setIsSuper] = useState(false)

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="mr-1 h-3 w-3" /> Criar usuário da agência
      </Button>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
      <p className="mb-3 text-sm font-bold text-slate-900">Criar usuário da agência</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@agencia.com" className="h-8 text-xs" />
        <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha (mín. 8)" type="text" className="h-8 text-xs" />
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={isSuper} onChange={(e) => setIsSuper(e.target.checked)} />
        <span>
          <strong>Admin geral</strong> — acessa e gerencia todas as clínicas. (desmarcado = suporte,
          acesso só às clínicas que você atribuir)
        </span>
      </label>
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const res = await createAgencyUserAction({ email, password, isSuper })
              notify(res, 'Usuário da agência criado.')
              if (res.ok) {
                setOpen(false)
                setEmail('')
                setPassword('')
                setIsSuper(false)
              }
            })
          }
        >
          {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null} Criar
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}
