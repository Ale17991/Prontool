'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Paperclip, Plus, X } from 'lucide-react'
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

interface TaxOption {
  id: string
  name: string
  rate_percent: string
}

const RECEIPT_MAX_BYTES = 10 * 1024 * 1024
const RECEIPT_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

/**
 * Formulário de nova despesa. Segue o padrão useState + fetch + inline error
 * do resto do projeto (ver `medicos/new-doctor-form.tsx`). Valor é
 * digitado em reais pelo usuário e convertido para centavos antes do POST.
 */
export function NewExpenseForm() {
  const router = useRouter()
  const [category, setCategory] = useState('materiais')
  const [description, setDescription] = useState('')
  const [supplier, setSupplier] = useState('')
  const [amount, setAmount] = useState('')
  const [competenceDate, setCompetenceDate] = useState(new Date().toISOString().slice(0, 10))
  const [recurring, setRecurring] = useState(false)
  const [frequency, setFrequency] = useState('mensal')
  // Feature 011 — US3: vínculo a imposto cadastrado.
  const [linkTax, setLinkTax] = useState(false)
  const [taxId, setTaxId] = useState<string>('')
  const [taxOptions, setTaxOptions] = useState<TaxOption[]>([])
  const [taxLoadError, setTaxLoadError] = useState<string | null>(null)
  const [receiptFiles, setReceiptFiles] = useState<File[]>([])
  const receiptInputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Carrega impostos ativos apenas quando o checkbox for marcado (lazy).
  useEffect(() => {
    if (!linkTax || taxOptions.length > 0) return
    let cancelled = false
    void (async () => {
      setTaxLoadError(null)
      try {
        const res = await fetch('/api/impostos?include_inactive=false')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const list = (await res.json()) as TaxOption[]
        if (!cancelled) setTaxOptions(list)
      } catch (err) {
        if (!cancelled) {
          setTaxLoadError(err instanceof Error ? err.message : 'Falha ao carregar impostos.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [linkTax, taxOptions.length])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const cents = toCents(amount)
    if (cents === null) {
      setError('Informe um valor válido (ex.: 120,50).')
      return
    }
    if (description.trim().length < 2) {
      setError('Descreva a despesa em pelo menos 2 caracteres.')
      return
    }
    if (linkTax && !taxId) {
      setError('Selecione o imposto cadastrado a que esta despesa se refere.')
      return
    }

    const oversize = receiptFiles.find((f) => f.size > RECEIPT_MAX_BYTES)
    if (oversize) {
      setError(`Comprovante "${oversize.name}" excede 10 MB.`)
      return
    }

    setPending(true)
    try {
      const res = await fetch('/api/despesas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // Quando linkTax=true, o server força category='impostos'; o que
          // mandamos aqui é cosmético (mas mandamos coerente para nao
          // confundir leitura do payload).
          category: linkTax ? 'impostos' : category,
          description: description.trim(),
          supplier: supplier.trim() || null,
          amount_cents: cents,
          competence_date: competenceDate,
          recurring,
          frequency: recurring ? frequency : null,
          ...(linkTax && taxId ? { tax_id: taxId } : {}),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao cadastrar a despesa.')
        return
      }
      const created = (await res.json().catch(() => ({}))) as { id?: string }

      // Upload de comprovantes (opcional). Se falhar, a despesa fica criada
      // sem comprovantes — usuario pode anexar depois pela lista.
      let uploadFailedMsg: string | null = null
      if (receiptFiles.length > 0 && created.id) {
        const fd = new FormData()
        for (const f of receiptFiles) fd.append('files', f)
        const upload = await fetch(`/api/despesas/${created.id}/comprovantes`, {
          method: 'POST',
          body: fd,
        })
        if (!upload.ok && upload.status !== 207) {
          const body = (await upload.json().catch(() => ({}))) as {
            error?: { message?: string }
          }
          uploadFailedMsg = body.error?.message ?? 'erro desconhecido'
        } else {
          const body = (await upload.json().catch(() => ({}))) as {
            failed?: Array<{ file_name: string; error?: { message?: string } }>
          }
          if (body.failed?.length) {
            uploadFailedMsg = body.failed
              .map((f) => `${f.file_name}: ${f.error?.message ?? 'falha'}`)
              .join(' · ')
          }
        }
      }

      if (uploadFailedMsg) {
        setError(
          `Despesa cadastrada, mas alguns comprovantes falharam: ${uploadFailedMsg}. Anexe pela lista.`,
        )
      } else {
        setSuccess(
          receiptFiles.length > 0
            ? `Despesa cadastrada com ${receiptFiles.length} comprovante${receiptFiles.length === 1 ? '' : 's'}.`
            : 'Despesa cadastrada.',
        )
      }
      setDescription('')
      setSupplier('')
      setAmount('')
      setRecurring(false)
      setLinkTax(false)
      setTaxId('')
      setReceiptFiles([])
      if (receiptInputRef.current) receiptInputRef.current.value = ''
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
        <input
          type="checkbox"
          checked={linkTax}
          onChange={(e) => {
            setLinkTax(e.target.checked)
            if (!e.target.checked) setTaxId('')
          }}
          className="h-4 w-4 rounded border-slate-300"
        />
        Vincular a imposto cadastrado?
      </label>

      {linkTax ? (
        <div>
          <Label className="text-[11px] font-bold uppercase text-slate-500">
            Imposto cadastrado
          </Label>
          <Select value={taxId} onValueChange={setTaxId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione um imposto…" />
            </SelectTrigger>
            <SelectContent>
              {taxOptions.length === 0 && !taxLoadError ? (
                <SelectItem value="__loading" disabled>
                  Carregando…
                </SelectItem>
              ) : null}
              {taxOptions.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} — {t.rate_percent} %
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {taxLoadError ? (
            <p className="mt-1 text-[11px] text-destructive">
              Falha ao carregar impostos: {taxLoadError}
            </p>
          ) : null}
          <p className="mt-1 text-[11px] text-slate-500">
            Categoria será forçada para &quot;Impostos&quot; e a despesa entrará no relatório
            separada das despesas operacionais.
          </p>
        </div>
      ) : (
        <div>
          <Label className="text-[11px] font-bold uppercase text-slate-500">Categoria</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="aluguel">Aluguel</SelectItem>
              <SelectItem value="equipamentos">Equipamentos</SelectItem>
              <SelectItem value="materiais">Materiais</SelectItem>
              <SelectItem value="pessoal">Pessoal</SelectItem>
              <SelectItem value="servicos">Serviços</SelectItem>
              <SelectItem value="impostos">Impostos</SelectItem>
              <SelectItem value="manutencao">Manutenção</SelectItem>
              <SelectItem value="outros">Outros</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div>
        <Label
          htmlFor="expense-description"
          className="text-[11px] font-bold uppercase text-slate-500"
        >
          Descrição
        </Label>
        <Input
          id="expense-description"
          placeholder="Ex.: Papelaria, manutenção AC…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </div>

      <div>
        <Label
          htmlFor="expense-supplier"
          className="text-[11px] font-bold uppercase text-slate-500"
        >
          Fornecedor (opcional)
        </Label>
        <Input
          id="expense-supplier"
          placeholder="Empresa ou pessoa"
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label
            htmlFor="expense-amount"
            className="text-[11px] font-bold uppercase text-slate-500"
          >
            Valor (R$)
          </Label>
          <Input
            id="expense-amount"
            placeholder="0,00"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="expense-date" className="text-[11px] font-bold uppercase text-slate-500">
            Competência
          </Label>
          <Input
            id="expense-date"
            type="date"
            value={competenceDate}
            onChange={(e) => setCompetenceDate(e.target.value)}
            required
          />
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
        <input
          type="checkbox"
          checked={recurring}
          onChange={(e) => setRecurring(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        Despesa recorrente
      </label>

      {recurring ? (
        <div>
          <Label className="text-[11px] font-bold uppercase text-slate-500">Frequência</Label>
          <Select value={frequency} onValueChange={setFrequency}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="semanal">Semanal</SelectItem>
              <SelectItem value="mensal">Mensal</SelectItem>
              <SelectItem value="anual">Anual</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div>
        <Label htmlFor="expense-receipt" className="text-[11px] font-bold uppercase text-slate-500">
          Comprovantes (opcional)
        </Label>
        {receiptFiles.length > 0 ? (
          <ul className="space-y-1">
            {receiptFiles.map((f, idx) => (
              <li
                key={`${f.name}-${idx}`}
                className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs"
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                <span className="flex-1 truncate text-slate-700">{f.name}</span>
                <span className="shrink-0 text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
                <button
                  type="button"
                  onClick={() => {
                    setReceiptFiles((prev) => prev.filter((_, i) => i !== idx))
                  }}
                  className="text-slate-400 hover:text-destructive"
                  aria-label="Remover comprovante"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <Input
          id="expense-receipt"
          ref={receiptInputRef}
          type="file"
          multiple
          accept={RECEIPT_ACCEPT}
          className={receiptFiles.length > 0 ? 'mt-2' : ''}
          onChange={(e) => {
            const incoming = Array.from(e.target.files ?? [])
            const oversize = incoming.find((f) => f.size > RECEIPT_MAX_BYTES)
            if (oversize) {
              setError(`Comprovante "${oversize.name}" excede 10 MB.`)
              e.target.value = ''
              return
            }
            setReceiptFiles((prev) => [...prev, ...incoming])
            e.target.value = ''
          }}
        />
        <p className="mt-1 text-[11px] text-slate-400">
          PDF, JPG ou PNG até 10 MB cada. Você pode adicionar vários.
        </p>
      </div>

      {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}
      {success ? <p className="text-xs font-semibold text-success-text">{success}</p> : null}

      <Button type="submit" disabled={pending} className="w-full gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Registrar despesa
      </Button>
    </form>
  )
}

/**
 * "120,50" ou "120.50" ou "120" → 12050 centavos. Retorna null se inválido.
 * Aceita vírgula como separador decimal (UX pt-BR).
 */
function toCents(input: string): number | null {
  const trimmed = input.trim().replace(/\s/g, '')
  if (!trimmed) return null
  const normalized = trimmed.replace(/\./g, '').replace(',', '.')
  const value = Number(normalized)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 100)
}
