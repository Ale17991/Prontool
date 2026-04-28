'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Paperclip, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'

const RECEIPT_MAX_BYTES = 10 * 1024 * 1024
const RECEIPT_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

interface Props {
  expenseId: string
  hasReceipt: boolean
  fileName: string | null
  /** Quem pode anexar/substituir comprovante. */
  canWrite: boolean
  /** Quem pode remover comprovante (admin only). */
  canDelete: boolean
}

/**
 * Acoes do comprovante de uma despesa, alinhadas com a regra:
 *   - leitor (qualquer papel) ve o clip + abre o arquivo (URL assinada).
 *   - admin/financeiro pode anexar (quando ausente) ou substituir (quando ja ha).
 *   - admin pode remover.
 */
export function ReceiptActions({
  expenseId,
  hasReceipt,
  fileName,
  canWrite,
  canDelete,
}: Props) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<'open' | 'upload' | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function openReceipt() {
    if (!hasReceipt) return
    setError(null)
    setPending('open')
    try {
      const res = await fetch(`/api/despesas/${expenseId}/comprovante`)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao abrir comprovante.')
        return
      }
      const body = (await res.json()) as { url: string; file_name: string }
      // Abre numa aba nova; o navegador escolhe download ou preview por content-type.
      window.open(body.url, '_blank', 'noopener,noreferrer')
    } finally {
      setPending(null)
    }
  }

  async function uploadReceipt(file: File) {
    if (file.size > RECEIPT_MAX_BYTES) {
      setError('Arquivo excede 10 MB.')
      return
    }
    setError(null)
    setPending('upload')
    try {
      const fd = new FormData()
      fd.set('file', file)
      const res = await fetch(`/api/despesas/${expenseId}/comprovante`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha no upload.')
        return
      }
      router.refresh()
    } finally {
      setPending(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function removeReceipt() {
    if (!confirm('Remover comprovante? A despesa permanece.')) return
    setError(null)
    setPending('remove')
    try {
      const res = await fetch(`/api/despesas/${expenseId}/comprovante`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao remover.')
        return
      }
      router.refresh()
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {hasReceipt ? (
        <>
          <button
            type="button"
            onClick={openReceipt}
            disabled={pending !== null}
            title={fileName ? `Abrir ${fileName}` : 'Abrir comprovante'}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            {pending === 'open' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Paperclip className="h-3 w-3" />
            )}
            <span className="max-w-[8rem] truncate">{fileName ?? 'abrir'}</span>
          </button>
          {canDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={removeReceipt}
              disabled={pending !== null}
              className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600"
              aria-label="Remover comprovante"
              title="Remover comprovante"
            >
              {pending === 'remove' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </Button>
          ) : null}
        </>
      ) : canWrite ? (
        <>
          <input
            ref={fileRef}
            type="file"
            accept={RECEIPT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void uploadReceipt(f)
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={pending !== null}
            className="h-7 gap-1 px-2 text-[11px] text-slate-500 hover:text-slate-800"
            title="Anexar comprovante"
          >
            {pending === 'upload' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Upload className="h-3 w-3" />
            )}
            anexar
          </Button>
        </>
      ) : null}
      {error ? (
        <span className="ml-2 text-[10px] font-semibold text-rose-600">{error}</span>
      ) : null}
    </div>
  )
}
