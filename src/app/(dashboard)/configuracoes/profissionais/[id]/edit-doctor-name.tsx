'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function EditDoctorName({
  doctorId,
  currentName,
}: {
  doctorId: string
  currentName: string
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(currentName)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || trimmed === currentName) {
      setEditing(false)
      return
    }
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/medicos/${doctorId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ full_name: trimmed }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(payload.error?.message ?? `HTTP ${res.status}`)
      }
      setEditing(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  if (!editing) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setEditing(true)}
        className="border-slate-200"
      >
        <Pencil className="mr-1 h-3 w-3" />
        Editar nome
      </Button>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required
        minLength={1}
        maxLength={200}
        className="w-64"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? '…' : 'Salvar'}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setEditing(false)
          setValue(currentName)
          setError(null)
        }}
      >
        Cancelar
      </Button>
      {error ? <span className="text-[10px] text-destructive">{error}</span> : null}
    </form>
  )
}
