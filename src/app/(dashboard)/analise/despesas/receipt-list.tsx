'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, ExternalLink, FileText, Loader2, Paperclip, Plus, Trash2 } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

const RECEIPT_MAX_BYTES = 10 * 1024 * 1024
const RECEIPT_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

export interface ReceiptItem {
  id: string
  file_name: string
  storage_path: string
  file_size_bytes: number
  content_type: string
  uploaded_at: string
  uploaded_by: string
}

interface Props {
  expenseId: string
  initialReceipts: ReceiptItem[]
  canWrite: boolean
  canDelete: boolean
}

/**
 * Lista 1:N de comprovantes de uma despesa.
 *  - Plus button (canWrite): file picker multi-select → POST /comprovantes.
 *  - Por item: Visualizar (URL assinada → nova aba), Baixar (URL assinada → download).
 *  - Por item (canDelete): Remover (DELETE /comprovantes/[id]).
 */
export function ReceiptList({ expenseId, initialReceipts, canWrite, canDelete }: Props) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [receipts, setReceipts] = useState<ReceiptItem[]>(initialReceipts)
  const [pendingUpload, setPendingUpload] = useState(false)
  const [pendingItem, setPendingItem] = useState<{
    id: string
    action: 'view' | 'download' | 'remove'
  } | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setReceipts(initialReceipts)
  }, [initialReceipts])

  useEffect(() => {
    let cancelled = false
    async function loadThumbs() {
      const targets = receipts.filter((r) => r.content_type.startsWith('image/') && !thumbs[r.id])
      for (const r of targets) {
        try {
          const res = await fetch(`/api/despesas/${expenseId}/comprovantes/${r.id}/url`)
          if (!res.ok) continue
          const body = (await res.json()) as { url: string }
          if (cancelled) return
          setThumbs((prev) => ({ ...prev, [r.id]: body.url }))
        } catch {
          // ignora
        }
      }
    }
    void loadThumbs()
    return () => {
      cancelled = true
    }
  }, [receipts, expenseId, thumbs])

  async function handleAdd(filesList: FileList) {
    const files = Array.from(filesList)
    if (files.length === 0) return

    const oversize = files.find((f) => f.size > RECEIPT_MAX_BYTES)
    if (oversize) {
      setError(`Arquivo "${oversize.name}" excede 10 MB.`)
      return
    }
    setError(null)
    setPendingUpload(true)
    try {
      const fd = new FormData()
      for (const f of files) fd.append('files', f)
      const res = await fetch(`/api/despesas/${expenseId}/comprovantes`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok && res.status !== 207) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha no upload.')
        return
      }
      const body = (await res.json()) as {
        uploaded: ReceiptItem[]
        failed: Array<{ file_name: string; error: { message: string } }>
      }
      if (body.failed?.length) {
        setError(
          body.failed.map((f) => `${f.file_name}: ${f.error?.message ?? 'falha'}`).join(' · '),
        )
      }
      router.refresh()
    } finally {
      setPendingUpload(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleView(receipt: ReceiptItem) {
    setError(null)
    setPendingItem({ id: receipt.id, action: 'view' })
    try {
      const res = await fetch(`/api/despesas/${expenseId}/comprovantes/${receipt.id}/url`)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha ao abrir.')
        return
      }
      const body = (await res.json()) as { url: string }
      window.open(body.url, '_blank', 'noopener,noreferrer')
    } finally {
      setPendingItem(null)
    }
  }

  async function handleDownload(receipt: ReceiptItem) {
    setError(null)
    setPendingItem({ id: receipt.id, action: 'download' })
    try {
      const res = await fetch(`/api/despesas/${expenseId}/comprovantes/${receipt.id}/url`)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha ao baixar.')
        return
      }
      const body = (await res.json()) as { url: string; file_name: string }
      const a = document.createElement('a')
      a.href = body.url
      a.download = body.file_name
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } finally {
      setPendingItem(null)
    }
  }

  async function handleRemove(receipt: ReceiptItem) {
    if (
      !confirm(`Remover "${receipt.file_name}"? O arquivo permanece no storage para auditoria.`)
    ) {
      return
    }
    setError(null)
    setPendingItem({ id: receipt.id, action: 'remove' })
    try {
      const res = await fetch(`/api/despesas/${expenseId}/comprovantes/${receipt.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha ao remover.')
        return
      }
      router.refresh()
    } finally {
      setPendingItem(null)
    }
  }

  if (receipts.length === 0 && !canWrite) {
    return <p className="text-[11px] italic text-slate-400">Sem comprovantes.</p>
  }

  return (
    <div className="space-y-2">
      {receipts.length === 0 ? (
        <p className="text-[11px] italic text-slate-400">Nenhum comprovante anexado.</p>
      ) : (
        <ul className="space-y-1">
          {receipts.map((r) => {
            const isImage = r.content_type.startsWith('image/')
            const pending = pendingItem?.id === r.id ? pendingItem.action : null
            return (
              <li
                key={r.id}
                className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-50 text-slate-400">
                  {isImage && thumbs[r.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbs[r.id]} alt="" className="h-full w-full object-cover" />
                  ) : isImage ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : r.content_type === 'application/pdf' ? (
                    <FileText className="h-5 w-5" />
                  ) : (
                    <Paperclip className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold text-slate-800">{r.file_name}</p>
                  <p className="text-[10px] text-slate-500">
                    {formatBytes(r.file_size_bytes)} · {formatDateTime(r.uploaded_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => void handleView(r)}
                    disabled={pending !== null}
                    title="Visualizar em nova aba"
                    className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
                  >
                    {pending === 'view' ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ExternalLink className="h-3 w-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownload(r)}
                    disabled={pending !== null}
                    title="Baixar"
                    className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
                  >
                    {pending === 'download' ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                  </button>
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => void handleRemove(r)}
                      disabled={pending !== null}
                      title="Remover"
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    >
                      {pending === 'remove' ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {canWrite ? (
        <>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={RECEIPT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void handleAdd(e.target.files)
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={pendingUpload}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 text-[11px] font-semibold text-slate-600 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
          >
            {pendingUpload ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
            Adicionar comprovante
          </button>
        </>
      ) : null}

      {error ? <p className="text-[10px] font-semibold text-destructive">{error}</p> : null}
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
