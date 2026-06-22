'use client'

import { useState } from 'react'
import { AlertCircle, MailPlus, Pencil, Send, ShieldCheck, ShieldOff, UserCog, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  labelForRole,
  labelForStatus,
  type TeamMember,
  type TeamMemberStatus,
} from '@/lib/core/team/types'
import { InviteUserDialog } from './invite-user-dialog'
import { ManualUserDialog } from './manual-user-dialog'
import { ChangeRoleDialog } from './change-role-dialog'
import { ChangeStatusDialog } from './change-status-dialog'
import { EditUserDialog } from './edit-user-dialog'
import { RowActionsMenu, type RowAction } from './row-actions-menu'

interface Props {
  initial: TeamMember[]
}

// 016 — design system tokens.
const STATUS_BADGE: Record<TeamMemberStatus, string> = {
  active: 'bg-success-bg text-success-text',
  pending: 'bg-[hsl(var(--warning)/0.2)] text-[hsl(var(--warning-foreground))]',
  disabled: 'bg-slate-200 text-slate-700',
}

export function UsersList({ initial }: Props) {
  const [users, setUsers] = useState(initial)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [roleTarget, setRoleTarget] = useState<TeamMember | null>(null)
  const [statusTarget, setStatusTarget] = useState<TeamMember | null>(null)
  const [editTarget, setEditTarget] = useState<TeamMember | null>(null)
  const [resending, setResending] = useState<string | null>(null)
  const [globalError, setGlobalError] = useState<string | null>(null)

  const refresh = async () => {
    const res = await fetch('/api/configuracoes/usuarios')
    if (!res.ok) return
    const body = (await res.json()) as { users: TeamMember[] }
    setUsers(body.users)
  }

  const onResend = async (user: TeamMember) => {
    setGlobalError(null)
    setResending(user.userId)
    try {
      const res = await fetch(
        `/api/configuracoes/usuarios/${user.userId}/reenviar-convite`,
        { method: 'POST' },
      )
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        throw new Error(body.error?.message ?? `HTTP ${res.status}`)
      }
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : String(err))
    } finally {
      setResending(null)
    }
  }

  const buildActions = (u: TeamMember): RowAction[] => {
    const actions: RowAction[] = [
      {
        label: 'Editar dados',
        icon: <Pencil className="h-3.5 w-3.5" />,
        onClick: () => setEditTarget(u),
      },
      {
        label: 'Alterar função',
        icon: <UserCog className="h-3.5 w-3.5" />,
        onClick: () => setRoleTarget(u),
      },
      {
        label: u.status === 'disabled' ? 'Reativar acesso' : 'Desativar acesso',
        icon:
          u.status === 'disabled' ? (
            <ShieldCheck className="h-3.5 w-3.5 text-success-strong" />
          ) : (
            <ShieldOff className="h-3.5 w-3.5" />
          ),
        onClick: () => setStatusTarget(u),
        danger: u.status !== 'disabled',
      },
    ]
    if (u.status === 'pending') {
      actions.push({
        label: resending === u.userId ? 'Reenviando…' : 'Reenviar convite',
        icon: <Send className="h-3.5 w-3.5" />,
        onClick: () => void onResend(u),
      })
    }
    return actions
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <p className="text-xs text-slate-500">{users.length} usuário(s) na clínica</p>
          <div className="flex items-center gap-2">
            <Button onClick={() => setManualOpen(true)} size="sm" variant="outline">
              <UserPlus className="mr-2 h-3 w-3" />
              Cadastrar usuário
            </Button>
            <Button onClick={() => setInviteOpen(true)} size="sm">
              <MailPlus className="mr-2 h-3 w-3" />
              Convidar por e-mail
            </Button>
          </div>
        </div>

        {globalError ? (
          <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
            {globalError}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-widest text-slate-500">
                <th className="px-4 py-3 font-bold">Usuário</th>
                <th className="px-4 py-3 font-bold">E-mail</th>
                <th className="px-4 py-3 font-bold">Função</th>
                <th className="px-4 py-3 font-bold">Profissional vinculado</th>
                <th className="px-4 py-3 font-bold">Status</th>
                <th className="px-4 py-3 font-bold">Último acesso</th>
                <th className="px-4 py-3 text-right font-bold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId} className="border-b border-slate-100">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-xs font-bold uppercase text-slate-600">
                        {u.avatar?.signedUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={u.avatar.signedUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          (u.fullName ?? u.email).slice(0, 1)
                        )}
                      </div>
                      <span className="text-sm font-medium text-slate-900">
                        {u.fullName ?? '—'}
                        {u.isSelf ? (
                          <span className="ml-2 text-[10px] text-slate-500">(você)</span>
                        ) : null}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{u.email}</td>
                  <td className="px-4 py-3 text-xs">{labelForRole(u.role)}</td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    {u.linkedDoctor ? (
                      <span className="font-semibold">{u.linkedDoctor.fullName}</span>
                    ) : u.role === 'profissional_saude' ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--warning-foreground))]">
                        <AlertCircle className="h-3 w-3" />
                        Sem profissional vinculado
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[u.status]}`}
                    >
                      {labelForStatus(u.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end">
                      <RowActionsMenu actions={buildActions(u)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>

      <InviteUserDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onSuccess={() => {
          setInviteOpen(false)
          void refresh()
        }}
      />

      <ManualUserDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        onSuccess={() => {
          setManualOpen(false)
          void refresh()
        }}
      />

      {editTarget ? (
        <EditUserDialog
          target={editTarget}
          onOpenChange={(open) => !open && setEditTarget(null)}
          onSuccess={() => {
            setEditTarget(null)
            void refresh()
          }}
        />
      ) : null}

      {roleTarget ? (
        <ChangeRoleDialog
          target={roleTarget}
          onOpenChange={(open) => !open && setRoleTarget(null)}
          onSuccess={() => {
            setRoleTarget(null)
            void refresh()
          }}
        />
      ) : null}

      {statusTarget ? (
        <ChangeStatusDialog
          target={statusTarget}
          onOpenChange={(open) => !open && setStatusTarget(null)}
          onSuccess={() => {
            setStatusTarget(null)
            void refresh()
          }}
        />
      ) : null}
    </Card>
  )
}
