'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, MapPin, Pencil, Save, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { PatientAddress } from '@/lib/core/patients/get'

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
  'SP', 'SE', 'TO',
]

function formatCep(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
}

export function AddressEditor({
  patientId,
  address,
  canEdit,
}: {
  patientId: string
  address: PatientAddress
  canEdit: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [cep, setCep] = useState(formatCep(address.cep ?? ''))
  const [street, setStreet] = useState(address.street ?? '')
  const [number, setNumber] = useState(address.number ?? '')
  const [complement, setComplement] = useState(address.complement ?? '')
  const [neighborhood, setNeighborhood] = useState(address.neighborhood ?? '')
  const [city, setCity] = useState(address.city ?? '')
  const [state, setState] = useState(address.state ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cepLookup, setCepLookup] = useState<'idle' | 'loading' | 'not-found' | 'error'>(
    'idle',
  )

  const hasAny = [
    address.cep,
    address.street,
    address.number,
    address.complement,
    address.neighborhood,
    address.city,
    address.state,
  ].some((v) => v && v.length > 0)

  function reset() {
    setCep(formatCep(address.cep ?? ''))
    setStreet(address.street ?? '')
    setNumber(address.number ?? '')
    setComplement(address.complement ?? '')
    setNeighborhood(address.neighborhood ?? '')
    setCity(address.city ?? '')
    setState(address.state ?? '')
    setError(null)
    setCepLookup('idle')
  }

  async function handleCepChange(raw: string) {
    const formatted = formatCep(raw)
    setCep(formatted)
    const digits = formatted.replace(/\D/g, '')
    if (digits.length !== 8) {
      setCepLookup('idle')
      return
    }
    setCepLookup('loading')
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
      if (!res.ok) {
        setCepLookup('error')
        return
      }
      const body = (await res.json()) as {
        erro?: boolean
        logradouro?: string
        bairro?: string
        localidade?: string
        uf?: string
      }
      if (body.erro) {
        setCepLookup('not-found')
        return
      }
      setCepLookup('idle')
      if (body.logradouro) setStreet(body.logradouro)
      if (body.bairro) setNeighborhood(body.bairro)
      if (body.localidade) setCity(body.localidade)
      if (body.uf) setState(body.uf)
    } catch {
      setCepLookup('error')
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const cepDigits = cep.replace(/\D/g, '')
      const res = await fetch(`/api/pacientes/${patientId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address: {
            cep: cepDigits || null,
            street: street.trim() || null,
            number: number.trim() || null,
            complement: complement.trim() || null,
            neighborhood: neighborhood.trim() || null,
            city: city.trim() || null,
            state: state || null,
          },
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao salvar endereço.')
        return
      }
      setEditing(false)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  if (!editing) {
    return (
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <MapPin className="h-3 w-3" /> Endereço
          </p>
          {canEdit ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
              className="h-7 gap-1 px-2 text-[11px]"
            >
              <Pencil className="h-3 w-3" />
              {hasAny ? 'Editar' : 'Adicionar'}
            </Button>
          ) : null}
        </div>
        {hasAny ? (
          <div className="text-sm text-slate-700">
            <p className="font-semibold">
              {[address.street, address.number].filter(Boolean).join(', ')}
              {address.complement ? ` — ${address.complement}` : ''}
            </p>
            <p className="text-xs text-slate-600">
              {[address.neighborhood, address.city, address.state]
                .filter(Boolean)
                .join(' · ')}
              {address.cep ? ` · CEP ${formatCep(address.cep)}` : ''}
            </p>
          </div>
        ) : (
          <p className="text-xs italic text-slate-400">Endereço não informado.</p>
        )}
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          <MapPin className="h-3 w-3" /> Editar endereço
        </p>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={() => {
            reset()
            setEditing(false)
          }}
          className="h-7 gap-1 px-2 text-[11px]"
        >
          <X className="h-3 w-3" />
          Cancelar
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="addr_cep">CEP</Label>
          <Input
            id="addr_cep"
            inputMode="numeric"
            placeholder="00000-000"
            value={cep}
            onChange={(e) => void handleCepChange(e.target.value)}
            maxLength={9}
          />
          {cepLookup === 'loading' ? (
            <p className="text-[11px] text-slate-500">Buscando CEP…</p>
          ) : cepLookup === 'not-found' ? (
            <p className="text-[11px] text-amber-700">CEP não encontrado.</p>
          ) : cepLookup === 'error' ? (
            <p className="text-[11px] text-amber-700">Falha ao consultar — preencha manual.</p>
          ) : null}
        </div>
        <div className="space-y-1.5 md:col-span-3">
          <Label htmlFor="addr_street">Rua / logradouro</Label>
          <Input
            id="addr_street"
            value={street}
            onChange={(e) => setStreet(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 md:col-span-1">
          <Label htmlFor="addr_number">Número</Label>
          <Input
            id="addr_number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 md:col-span-3">
          <Label htmlFor="addr_complement">Complemento</Label>
          <Input
            id="addr_complement"
            value={complement}
            onChange={(e) => setComplement(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 md:col-span-3">
          <Label htmlFor="addr_neighborhood">Bairro</Label>
          <Input
            id="addr_neighborhood"
            value={neighborhood}
            onChange={(e) => setNeighborhood(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 md:col-span-4">
          <Label htmlFor="addr_city">Cidade</Label>
          <Input id="addr_city" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="addr_state">Estado</Label>
          <Select value={state} onValueChange={setState}>
            <SelectTrigger id="addr_state">
              <SelectValue placeholder="UF" />
            </SelectTrigger>
            <SelectContent>
              {UFS.map((uf) => (
                <SelectItem key={uf} value={uf}>
                  {uf}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending} className="gap-2">
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Salvar endereço
        </Button>
      </div>
    </form>
  )
}
