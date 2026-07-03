'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PLAN_LABEL } from '@/lib/core/entitlements/plans'
import { adminCreateClinicAction } from '../actions'

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

export function CreateClinicDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [plan, setPlan] = useState('essencial')
  const [adminName, setAdminName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const effectiveSlug = slugTouched ? slug : slugify(name)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await adminCreateClinicAction({
        name,
        slug: effectiveSlug,
        plan,
        adminName,
        adminEmail,
        adminPassword,
      })
      if (res.ok) {
        setOpen(false)
        setName('')
        setSlug('')
        setSlugTouched(false)
        setAdminName('')
        setAdminEmail('')
        setAdminPassword('')
        router.refresh()
      } else {
        setError(res.error ?? 'Erro ao criar.')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Nova clínica
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            Nova clínica
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label className="text-[11px] font-bold uppercase text-slate-500">
              Nome da clínica
            </Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <Label className="text-[11px] font-bold uppercase text-slate-500">Slug (URL)</Label>
            <Input
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(slugify(e.target.value))
              }}
              placeholder="clinica-exemplo"
            />
          </div>
          <div>
            <Label className="text-[11px] font-bold uppercase text-slate-500">Plano</Label>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              {(['essencial', 'pro', 'clinica', 'legacy'] as const).map((p) => (
                <option key={p} value={p}>
                  {PLAN_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
              Administrador inicial
            </p>
            <div className="space-y-2">
              <Input
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                placeholder="Nome do admin"
              />
              <Input
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="email@clinica.com"
              />
              <Input
                type="text"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="Senha inicial (mín. 8)"
              />
            </div>
          </div>
          {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} className="gap-2">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Criar clínica
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
