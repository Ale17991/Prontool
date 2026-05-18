'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Stethoscope } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { slugify } from '@/lib/core/auth/slug'
import { formatCnpj, stripCnpj } from '@/lib/core/clinic-profile/validate-cnpj'

/**
 * Feature 010 (US2) — Onboarding: cria a primeira clínica.
 *
 * Estado controlado: o slug é derivado do nome até o usuário tocar manualmente
 * no campo (a partir daí, fica sob controle dele). O check de disponibilidade
 * roda com debounce 300ms via /api/onboarding/check-slug.
 */
export function OnboardingForm({ initialName }: { initialName: string }) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [cnpj, setCnpj] = useState('')
  const [phone, setPhone] = useState('')
  const [slug, setSlug] = useState(() => (initialName ? slugify(initialName) : ''))
  const [slugTouched, setSlugTouched] = useState(false)
  const [slugAvailable, setSlugAvailable] = useState<null | boolean>(null)
  const [slugSuggested, setSlugSuggested] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!slugTouched) {
      setSlug(slugify(name))
    }
  }, [name, slugTouched])

  useEffect(() => {
    if (!slug) {
      setSlugAvailable(null)
      setSlugSuggested(null)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/onboarding/check-slug?slug=${encodeURIComponent(slug)}`)
        if (!res.ok) {
          setSlugAvailable(null)
          setSlugSuggested(null)
          return
        }
        const body = (await res.json()) as {
          available: boolean
          suggested: string | null
        }
        setSlugAvailable(body.available)
        setSlugSuggested(body.suggested)
      } catch {
        setSlugAvailable(null)
        setSlugSuggested(null)
      }
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [slug])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      if (!name.trim()) throw new Error('Nome da clínica é obrigatório.')
      const cnpjDigits = cnpj ? stripCnpj(cnpj) : ''
      if (cnpjDigits && cnpjDigits.length !== 14) {
        throw new Error('CNPJ deve ter 14 dígitos. Deixe em branco se não tiver.')
      }
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug || undefined,
          cnpj: cnpjDigits || undefined,
          phone: phone.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(body?.error?.message ?? 'Não foi possível criar a clínica.')
      }
      const supabase = createSupabaseBrowserClient()
      await supabase.auth.refreshSession()
      router.push('/operacao/atendimentos')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar clínica.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6 font-sans">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/20">
            <Stethoscope className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-slate-900">
              Criar minha clínica
            </h1>
            <p className="text-xs text-slate-500">
              Ou peça ao administrador de uma clínica existente para te convidar.
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome da clínica</Label>
            <Input
              id="name"
              type="text"
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Clínica Sorriso"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="slug">URL da clínica (slug)</Label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">prontool.app/</span>
              <Input
                id="slug"
                type="text"
                value={slug}
                maxLength={60}
                onChange={(e) => {
                  setSlug(e.target.value.toLowerCase())
                  setSlugTouched(true)
                }}
                placeholder="clinica-sorriso"
              />
            </div>
            {slug ? (
              slugAvailable === true ? (
                <p className="text-[11px] font-medium text-emerald-600">
                  Disponível.
                </p>
              ) : slugAvailable === false && slugSuggested ? (
                <p className="text-[11px] font-medium text-amber-700">
                  Em uso. Sugestão:{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setSlug(slugSuggested)
                      setSlugTouched(true)
                    }}
                  >
                    {slugSuggested}
                  </button>
                </p>
              ) : null
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cnpj">CNPJ (opcional)</Label>
            <Input
              id="cnpj"
              type="text"
              value={cnpj}
              maxLength={18}
              onChange={(e) => {
                const digits = stripCnpj(e.target.value)
                setCnpj(formatCnpj(digits))
              }}
              placeholder="00.000.000/0000-00"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone (opcional)</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              maxLength={20}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(11) 99999-9999"
            />
          </div>

          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Criando…' : 'Criar clínica'}
          </Button>
        </form>
      </div>
    </main>
  )
}
