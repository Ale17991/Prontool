'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function NewPlanForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setPending(true)
    try {
      const res = await fetch('/api/planos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (res.status === 409) {
        setError(`Já existe um convênio com o nome "${name.trim()}".`)
        return
      }
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(payload.error?.message ?? `HTTP ${res.status}`)
      }
      setSuccess(`Convênio "${name.trim()}" cadastrado.`)
      setName('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="plan-name" className="text-xs">
          Nome do convênio
        </Label>
        <Input
          id="plan-name"
          required
          minLength={1}
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Unimed, Bradesco, Particular"
        />
      </div>

      <Button type="submit" disabled={pending || name.trim().length === 0} className="w-full">
        {pending ? 'Salvando…' : 'Cadastrar convênio'}
      </Button>

      {error ? (
        <p className="rounded-md border border-rose-100 bg-rose-50 p-3 text-xs font-medium text-rose-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-emerald-100 bg-emerald-50 p-3 text-xs font-medium text-emerald-700">
          {success}
        </p>
      ) : null}
    </form>
  )
}
