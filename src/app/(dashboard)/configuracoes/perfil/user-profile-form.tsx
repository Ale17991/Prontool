'use client'

import { useRef, useState } from 'react'
import { Loader2, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MAX_AVATAR_BYTES, type UserProfile } from '@/lib/core/user-profile/types'

const COMMON_TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Belem',
  'America/Fortaleza',
  'America/Recife',
  'America/Cuiaba',
  'America/Rio_Branco',
  'America/Noronha',
  'UTC',
]

interface Props {
  initial: UserProfile
}

export function UserProfileForm({ initial }: Props) {
  const [profile, setProfile] = useState(initial)
  const [fullName, setFullName] = useState(initial.fullName ?? '')
  const [timezone, setTimezone] = useState(initial.timezone)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const onAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    if (file.size > MAX_AVATAR_BYTES) {
      setError('Avatar excede 2 MB')
      return
    }
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('Use JPG ou PNG')
      return
    }
    setAvatarBusy(true)
    try {
      const fd = new FormData()
      fd.append('avatar', file)
      const res = await fetch('/api/configuracoes/perfil/avatar', { method: 'POST', body: fd })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        throw new Error(body.error?.message ?? `HTTP ${res.status}`)
      }
      const body = (await res.json()) as { avatar: UserProfile['avatar'] }
      setProfile((prev) => ({ ...prev, avatar: body.avatar }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAvatarBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const onAvatarRemove = async () => {
    setError(null)
    setAvatarBusy(true)
    try {
      const res = await fetch('/api/configuracoes/perfil/avatar', { method: 'DELETE' })
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`)
      setProfile((prev) => ({ ...prev, avatar: null }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAvatarBusy(false)
    }
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/configuracoes/perfil', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim() || null,
          timezone,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        throw new Error(body.error?.message ?? `HTTP ${res.status}`)
      }
      const updated = (await res.json()) as UserProfile
      setProfile(updated)
      setFullName(updated.fullName ?? '')
      setTimezone(updated.timezone)
      setSavedAt(new Date().toISOString())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardContent className="space-y-4 p-6">
          <div>
            <h2 className="text-base font-bold text-slate-900">Foto de perfil</h2>
            <p className="text-xs text-slate-500">JPG ou PNG, até 2 MB.</p>
          </div>
          <div className="flex items-start gap-6">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-2xl font-bold uppercase text-slate-500">
              {profile.avatar?.signedUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={profile.avatar.signedUrl}
                  alt="Avatar"
                  className="h-full w-full object-cover"
                />
              ) : (
                profile.email?.slice(0, 1) ?? '?'
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={onAvatarChange}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={avatarBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                {avatarBusy ? (
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-3 w-3" />
                )}
                {profile.avatar ? 'Substituir' : 'Enviar foto'}
              </Button>
              {profile.avatar ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={avatarBusy}
                  onClick={onAvatarRemove}
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                >
                  <Trash2 className="mr-2 h-3 w-3" /> Remover
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label htmlFor="fullName">Nome completo</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={200}
            />
          </div>
          <div>
            <Label htmlFor="email">E-mail (somente leitura)</Label>
            <Input id="email" value={profile.email ?? ''} readOnly disabled />
            <p className="mt-1 text-[11px] text-slate-500">
              Mudanças de e-mail não são feitas aqui.
            </p>
          </div>
          <div>
            <Label htmlFor="timezone">Fuso horário</Label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
              {!COMMON_TIMEZONES.includes(timezone) ? (
                <option value={timezone}>{timezone} (atual)</option>
              ) : null}
            </select>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {savedAt ? <span>Salvo às {new Date(savedAt).toLocaleTimeString('pt-BR')}</span> : null}
          {error ? <span className="text-red-600">{error}</span> : null}
        </div>
        <Button type="submit" disabled={saving || avatarBusy}>
          {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
          Salvar
        </Button>
      </div>
    </form>
  )
}
