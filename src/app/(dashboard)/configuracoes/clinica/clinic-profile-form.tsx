'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Loader2, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCnpj, isValidCnpj, stripCnpj } from '@/lib/core/clinic-profile/validate-cnpj'
import {
  COUNCIL_CODES,
  MAX_LOGO_BYTES,
  UF_CODES,
  type ClinicProfile,
} from '@/lib/core/clinic-profile/types'

interface Props {
  initial: ClinicProfile
}

interface FormState {
  displayName: string
  corporateName: string
  cnpj: string
  cnpjMasked: string
  phone: string
  email: string
  cep: string
  street: string
  number: string
  complement: string
  neighborhood: string
  city: string
  uf: string
  techName: string
  techCouncil: string
  techRegistration: string
}

function profileToForm(p: ClinicProfile): FormState {
  return {
    displayName: p.displayName ?? '',
    corporateName: p.corporateName ?? '',
    cnpj: p.cnpj ?? '',
    cnpjMasked: p.cnpj ? formatCnpj(p.cnpj) : '',
    phone: p.phone ?? '',
    email: p.email ?? '',
    cep: p.address.cep ?? '',
    street: p.address.street ?? '',
    number: p.address.number ?? '',
    complement: p.address.complement ?? '',
    neighborhood: p.address.neighborhood ?? '',
    city: p.address.city ?? '',
    uf: p.address.uf ?? '',
    techName: p.techResponsible.name ?? '',
    techCouncil: p.techResponsible.council ?? '',
    techRegistration: p.techResponsible.registration ?? '',
  }
}

function formToPatch(s: FormState) {
  return {
    displayName: s.displayName.trim() || null,
    corporateName: s.corporateName.trim() || null,
    cnpj: s.cnpj || null,
    phone: s.phone.trim() || null,
    email: s.email.trim() || null,
    address: {
      cep: s.cep.replace(/\D+/g, '') || null,
      street: s.street.trim() || null,
      number: s.number.trim() || null,
      complement: s.complement.trim() || null,
      neighborhood: s.neighborhood.trim() || null,
      city: s.city.trim() || null,
      uf: s.uf || null,
    },
    techResponsible: {
      name: s.techName.trim() || null,
      council: s.techCouncil || null,
      registration: s.techRegistration.trim() || null,
    },
  }
}

export function ClinicProfileForm({ initial }: Props) {
  const [profile, setProfile] = useState(initial)
  const [form, setForm] = useState<FormState>(profileToForm(initial))
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cnpjError, setCnpjError] = useState<string | null>(null)
  const [cepLoading, setCepLoading] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  // Lookup CEP automático quando completar 8 dígitos
  useEffect(() => {
    const digits = form.cep.replace(/\D+/g, '')
    if (digits.length !== 8) return
    let cancelled = false
    setCepLoading(true)
    void (async () => {
      try {
        const res = await fetch(`/api/configuracoes/cep/${digits}`)
        if (!res.ok) return
        const data = (await res.json()) as
          | { ok: true; address: { street: string | null; neighborhood: string | null; city: string | null; uf: string | null } }
          | { ok: false; reason: string }
        if (cancelled || !data.ok) return
        setForm((prev) => ({
          ...prev,
          street: prev.street || data.address.street || '',
          neighborhood: prev.neighborhood || data.address.neighborhood || '',
          city: prev.city || data.address.city || '',
          uf: prev.uf || data.address.uf || '',
        }))
      } finally {
        if (!cancelled) setCepLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [form.cep])

  const onCnpjChange = (raw: string) => {
    const masked = formatCnpj(raw)
    const digits = stripCnpj(raw)
    setForm((prev) => ({ ...prev, cnpj: digits, cnpjMasked: masked }))
    if (digits.length === 14) {
      setCnpjError(isValidCnpj(digits) ? null : 'CNPJ inválido')
    } else if (digits.length === 0) {
      setCnpjError(null)
    } else {
      setCnpjError(null)
    }
  }

  const onLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    if (file.size > MAX_LOGO_BYTES) {
      setError('Logo excede 2 MB')
      return
    }
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('Use JPG ou PNG')
      return
    }
    setLogoUploading(true)
    try {
      const fd = new FormData()
      fd.append('logo', file)
      const res = await fetch('/api/configuracoes/clinica/logo', { method: 'POST', body: fd })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        throw new Error(body.error?.message ?? `HTTP ${res.status}`)
      }
      const body = (await res.json()) as { logo: ClinicProfile['logo'] }
      setProfile((prev) => ({ ...prev, logo: body.logo }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLogoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const onLogoRemove = async () => {
    setError(null)
    setLogoUploading(true)
    try {
      const res = await fetch('/api/configuracoes/clinica/logo', { method: 'DELETE' })
      if (!res.ok && res.status !== 204) {
        throw new Error(`HTTP ${res.status}`)
      }
      setProfile((prev) => ({ ...prev, logo: null }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLogoUploading(false)
    }
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (form.cnpj.length > 0 && !isValidCnpj(form.cnpj)) {
      setCnpjError('CNPJ inválido')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/configuracoes/clinica', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToPatch(form)),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        throw new Error(body.error?.message ?? `HTTP ${res.status}`)
      }
      const updated = (await res.json()) as ClinicProfile
      setProfile(updated)
      setForm(profileToForm(updated))
      setSavedAt(new Date().toISOString())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Logo */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <div>
            <h2 className="text-base font-bold text-slate-900">Logotipo</h2>
            <p className="text-xs text-slate-500">JPG ou PNG, até 2 MB.</p>
          </div>
          <div className="flex items-start gap-6">
            <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              {profile.logo?.signedUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={profile.logo.signedUrl} alt="Logo" className="h-full w-full object-contain" />
              ) : (
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  Sem logo
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={onLogoChange}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={logoUploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {logoUploading ? (
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-3 w-3" />
                )}
                {profile.logo ? 'Substituir' : 'Enviar logo'}
              </Button>
              {profile.logo ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={logoUploading}
                  onClick={onLogoRemove}
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                >
                  <Trash2 className="mr-2 h-3 w-3" /> Remover logo
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dados da clínica */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label htmlFor="displayName">Nome de exibição</Label>
            <Input
              id="displayName"
              value={form.displayName}
              onChange={(e) => update('displayName', e.target.value)}
              maxLength={200}
              placeholder="Como a clínica aparece na sidebar e nos PDFs"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Aparece em destaque na sidebar, no seletor de clínicas e como título
              dos PDFs.
            </p>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="corporateName">Razão social / Nome fantasia</Label>
            <Input
              id="corporateName"
              value={form.corporateName}
              onChange={(e) => update('corporateName', e.target.value)}
              maxLength={200}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Nome legal completo. Aparece junto ao CNPJ no rodapé dos PDFs.
            </p>
          </div>
          <div>
            <Label htmlFor="cnpj">CNPJ</Label>
            <Input
              id="cnpj"
              value={form.cnpjMasked}
              onChange={(e) => onCnpjChange(e.target.value)}
              placeholder="00.000.000/0000-00"
              maxLength={18}
              aria-invalid={cnpjError ? 'true' : undefined}
            />
            {cnpjError ? <p className="mt-1 text-xs text-red-600">{cnpjError}</p> : null}
          </div>
          <div>
            <Label htmlFor="phone">Telefone</Label>
            <Input
              id="phone"
              value={form.phone}
              onChange={(e) => update('phone', e.target.value)}
              placeholder="(11) 99999-0000"
              maxLength={20}
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              placeholder="contato@clinica.com.br"
              maxLength={200}
            />
          </div>
        </CardContent>
      </Card>

      {/* Endereço */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 p-6 md:grid-cols-6">
          <div className="md:col-span-2">
            <Label htmlFor="cep">
              CEP{cepLoading ? <Loader2 className="ml-2 inline h-3 w-3 animate-spin" /> : null}
            </Label>
            <Input
              id="cep"
              value={form.cep}
              onChange={(e) => update('cep', e.target.value.replace(/\D+/g, '').slice(0, 8))}
              placeholder="00000000"
              maxLength={8}
            />
          </div>
          <div className="md:col-span-3">
            <Label htmlFor="street">Logradouro</Label>
            <Input
              id="street"
              value={form.street}
              onChange={(e) => update('street', e.target.value)}
              maxLength={200}
            />
          </div>
          <div>
            <Label htmlFor="number">Número</Label>
            <Input
              id="number"
              value={form.number}
              onChange={(e) => update('number', e.target.value)}
              maxLength={20}
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="complement">Complemento</Label>
            <Input
              id="complement"
              value={form.complement}
              onChange={(e) => update('complement', e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="neighborhood">Bairro</Label>
            <Input
              id="neighborhood"
              value={form.neighborhood}
              onChange={(e) => update('neighborhood', e.target.value)}
              maxLength={100}
            />
          </div>
          <div>
            <Label htmlFor="city">Cidade</Label>
            <Input
              id="city"
              value={form.city}
              onChange={(e) => update('city', e.target.value)}
              maxLength={100}
            />
          </div>
          <div>
            <Label htmlFor="uf">UF</Label>
            <select
              id="uf"
              value={form.uf}
              onChange={(e) => update('uf', e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              <option value="">—</option>
              {UF_CODES.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Responsável técnico */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 p-6 md:grid-cols-6">
          <div className="md:col-span-3">
            <Label htmlFor="techName">Responsável técnico</Label>
            <Input
              id="techName"
              value={form.techName}
              onChange={(e) => update('techName', e.target.value)}
              maxLength={200}
            />
          </div>
          <div>
            <Label htmlFor="techCouncil">Conselho</Label>
            <select
              id="techCouncil"
              value={form.techCouncil}
              onChange={(e) => update('techCouncil', e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              <option value="">—</option>
              {COUNCIL_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="techRegistration">Número de registro</Label>
            <Input
              id="techRegistration"
              value={form.techRegistration}
              onChange={(e) => update('techRegistration', e.target.value)}
              maxLength={30}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {savedAt ? <span>Salvo às {new Date(savedAt).toLocaleTimeString('pt-BR')}</span> : null}
          {error ? <span className="text-destructive">{error}</span> : null}
        </div>
        <Button type="submit" disabled={saving || logoUploading}>
          {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
          Salvar
        </Button>
      </div>
    </form>
  )
}
