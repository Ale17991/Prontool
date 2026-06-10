'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Loader2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  TENANT_ROLES_ORDERED,
  labelForRole,
  labelForStatus,
  type TeamMember,
} from '@/lib/core/team/types'
import {
  adminCreateUserAction,
  adminEditNameAction,
  adminInviteUserAction,
  adminResetPasswordAction,
  adminSetRoleAction,
  adminSetStatusAction,
} from './actions'

interface TenantOption {
  tenantId: string
  name: string
  slug: string
}

export function UsersPanel({
  tenants,
  selectedTenantId,
  members,
}: {
  tenants: TenantOption[]
  selectedTenantId: string | null
  members: TeamMember[]
}) {
  const router = useRouter()
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)
  const [pending, startTransition] = useTransition()

  if (tenants.length === 0) {
    return <p className="text-sm text-slate-500">Nenhuma clínica ativa.</p>
  }

  function notify(res: { ok: boolean; error?: string }, okMsg = 'Feito.') {
    setFeedback(res.ok ? { kind: 'ok', msg: okMsg } : { kind: 'error', msg: res.error ?? 'Erro.' })
    if (res.ok) router.refresh()
  }

  return (
    <div className="space-y-5">
      {/* Seletor de clínica */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-semibold text-slate-600">Clínica</label>
        <select
          value={selectedTenantId ?? ''}
          onChange={(e) => router.push(`/admin/usuarios?tenant=${e.target.value}`)}
          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"
        >
          {tenants.map((t) => (
            <option key={t.tenantId} value={t.tenantId}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

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

      {selectedTenantId ? (
        <>
          <CreateUser
            tenantId={selectedTenantId}
            pending={pending}
            run={(fn) => startTransition(fn)}
            notify={notify}
          />

          <div className="space-y-2">
            {members.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum usuário nesta clínica.</p>
            ) : (
              members.map((m) => (
                <MemberRow
                  key={m.userId}
                  tenantId={selectedTenantId}
                  member={m}
                  pending={pending}
                  run={(fn) => startTransition(fn)}
                  notify={notify}
                />
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}

function MemberRow({
  tenantId,
  member,
  pending,
  run,
  notify,
}: {
  tenantId: string
  member: TeamMember
  pending: boolean
  run: (fn: () => Promise<void>) => void
  notify: (res: { ok: boolean; error?: string }, okMsg?: string) => void
}) {
  const [name, setName] = useState(member.fullName ?? '')
  const [resetLink, setResetLink] = useState<string | null>(null)
  const nameDirty = name.trim() !== (member.fullName ?? '')

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900">{member.email}</p>
          <p className="text-[11px] text-slate-400">
            {labelForStatus(member.status)}
            {member.lastSignInAt
              ? ` · último acesso ${new Date(member.lastSignInAt).toLocaleDateString('pt-BR')}`
              : ' · nunca acessou'}
            {member.isSelf ? ' · você' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={member.role}
            disabled={pending}
            onChange={(e) =>
              run(async () => notify(await adminSetRoleAction(tenantId, member.userId, e.target.value), 'Papel atualizado.'))
            }
            className="rounded-md border border-slate-200 px-2 py-1 text-xs"
          >
            {TENANT_ROLES_ORDERED.map((r) => (
              <option key={r} value={r}>
                {labelForRole(r)}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(async () =>
                notify(
                  await adminSetStatusAction(
                    tenantId,
                    member.userId,
                    member.status === 'disabled' ? 'active' : 'disabled',
                  ),
                  member.status === 'disabled' ? 'Reativado.' : 'Desativado.',
                ),
              )
            }
          >
            {member.status === 'disabled' ? 'Reativar' : 'Desativar'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const res = await adminResetPasswordAction(member.userId)
                if (res.ok && res.link) setResetLink(res.link)
                notify(res, 'Link de redefinição gerado.')
              })
            }
          >
            Resetar senha
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome completo"
          className="h-8 max-w-xs text-xs"
          maxLength={200}
        />
        {nameDirty ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(async () => notify(await adminEditNameAction(member.userId, name), 'Nome salvo.'))
            }
          >
            Salvar nome
          </Button>
        ) : null}
      </div>

      {resetLink ? (
        <div className="mt-2 flex items-center gap-2">
          <code className="truncate rounded bg-slate-100 px-2 py-1 text-[10px] text-slate-600">
            {resetLink}
          </code>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(resetLink).catch(() => {})}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-link hover:text-link-hover"
          >
            <Copy className="h-3 w-3" /> copiar
          </button>
        </div>
      ) : null}
    </div>
  )
}

function CreateUser({
  tenantId,
  pending,
  run,
  notify,
}: {
  tenantId: string
  pending: boolean
  run: (fn: () => Promise<void>) => void
  notify: (res: { ok: boolean; error?: string }, okMsg?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<string>('recepcionista')

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="mr-1 h-3 w-3" /> Criar usuário
      </Button>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
      <p className="mb-3 text-sm font-bold text-slate-900">Criar usuário</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nome completo" className="h-8 text-xs" />
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@clinica.com" className="h-8 text-xs" />
        <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha (mín. 8)" type="text" className="h-8 text-xs" />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="h-8 rounded-md border border-slate-200 px-2 text-xs"
        >
          {TENANT_ROLES_ORDERED.map((r) => (
            <option key={r} value={r}>
              {labelForRole(r)}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const res = await adminCreateUserAction(tenantId, { fullName, email, password, role })
              notify(res, 'Usuário criado.')
              if (res.ok) {
                setOpen(false)
                setFullName('')
                setEmail('')
                setPassword('')
              }
            })
          }
        >
          {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null} Criar
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const res = await adminInviteUserAction(tenantId, { email, role })
              notify(res, 'Convite enviado.')
              if (res.ok) {
                setOpen(false)
                setEmail('')
              }
            })
          }
        >
          Convidar por e-mail
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}
