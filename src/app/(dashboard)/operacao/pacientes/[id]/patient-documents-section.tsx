'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Download, FileText, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type DocType = 'atestado' | 'declaracao' | 'receita' | 'laudo' | 'outro'

interface DocRow {
  id: string
  docType: DocType
  title: string
  cidCode: string | null
  cidDescription: string | null
  issuedAt: string | null
  deliveredAt: string | null
  createdAt: string
}

const TYPE_LABEL: Record<DocType, string> = {
  atestado: 'Atestado',
  declaracao: 'Declaração',
  receita: 'Receita',
  laudo: 'Laudo',
  outro: 'Documento',
}

/**
 * Backlog 1/10 + 1/4/1 — emitir/listar documentos do paciente (atestado com
 * CID opcional) e baixar PDF. Self-contained (GET/POST imediatos).
 */
export function PatientDocumentsSection({
  patientId,
  canWrite,
}: {
  patientId: string
  canWrite: boolean
}) {
  const [docs, setDocs] = useState<DocRow[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [docType, setDocType] = useState<DocType>('atestado')
  const [title, setTitle] = useState('Atestado médico')
  const [body, setBody] = useState('')
  const [withCid, setWithCid] = useState(false)
  const [cidCode, setCidCode] = useState('')
  const [cidDescription, setCidDescription] = useState('')
  const [paperSize, setPaperSize] = useState<'A4' | 'A5' | 'LETTER'>('A4')
  const [fontSize, setFontSize] = useState(11)
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/pacientes/${patientId}/documentos`, { cache: 'no-store' })
      if (res.ok) {
        const body = (await res.json()) as { rows: DocRow[] }
        setDocs(body.rows)
      }
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/document-templates', { cache: 'no-store' })
        if (res.ok) {
          const b = (await res.json()) as { rows: Array<{ id: string; name: string }> }
          setTemplates(b.rows)
        }
      } catch {
        /* modelos são opcionais */
      }
    })()
  }, [])

  async function applyTemplate(id: string) {
    if (!id) return
    setError(null)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/documentos/modelo/${id}`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        setError('Falha ao aplicar o modelo.')
        return
      }
      const a = (await res.json()) as {
        title: string
        docType: DocType
        body: string
        paperSize: 'A4' | 'A5' | 'LETTER'
        fontSize: number
      }
      setDocType(a.docType)
      setTitle(a.title)
      setBody(a.body)
      setPaperSize(a.paperSize)
      setFontSize(a.fontSize)
    } catch {
      setError('Falha ao aplicar o modelo.')
    }
  }

  async function emit() {
    setError(null)
    if (title.trim().length < 1 || body.trim().length < 1) {
      setError('Preencha título e conteúdo.')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/documentos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          doc_type: docType,
          title: title.trim(),
          body: body.trim(),
          cid_code: withCid ? cidCode.trim() || null : null,
          cid_description: withCid ? cidDescription.trim() || null : null,
          paper_size: paperSize,
          font_size: fontSize,
        }),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(b.error?.message ?? 'Falha ao emitir.')
        return
      }
      setBody('')
      setCidCode('')
      setCidDescription('')
      setWithCid(false)
      setOpen(false)
      await load()
    } finally {
      setPending(false)
    }
  }

  async function toggleDelivered(id: string, current: boolean) {
    // Backlog 1/4/2 — alterna entrega ao paciente (otimista).
    setDocs((prev) =>
      prev.map((d) =>
        d.id === id ? { ...d, deliveredAt: current ? null : new Date().toISOString() } : d,
      ),
    )
    try {
      const res = await fetch(`/api/pacientes/${patientId}/documentos/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ delivered: !current }),
      })
      if (!res.ok) await load()
    } catch {
      await load()
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4 text-primary" />
          Documentos
        </CardTitle>
        {canWrite ? (
          <div className="flex items-center gap-2">
            <a
              href="/configuracoes/modelos-documento"
              className="text-[11px] font-semibold text-link hover:underline"
            >
              Modelos
            </a>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() => setOpen((v) => !v)}
            >
              <Plus className="h-3.5 w-3.5" /> Emitir
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {open && canWrite ? (
          <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/50 p-3">
            {templates.length > 0 ? (
              <div>
                <Label className="text-[11px] font-bold uppercase text-slate-500">
                  Usar modelo (opcional)
                </Label>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) void applyTemplate(e.target.value)
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Selecione um modelo…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr]">
              <div>
                <Label className="text-[11px] font-bold uppercase text-slate-500">Tipo</Label>
                <Select value={docType} onValueChange={(v) => setDocType(v as DocType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="atestado">Atestado</SelectItem>
                    <SelectItem value="declaracao">Declaração</SelectItem>
                    <SelectItem value="receita">Receita</SelectItem>
                    <SelectItem value="laudo">Laudo</SelectItem>
                    <SelectItem value="outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px] font-bold uppercase text-slate-500">Título</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-[11px] font-bold uppercase text-slate-500">Conteúdo</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                maxLength={8000}
                placeholder="Ex.: Atesto, para os devidos fins, que o(a) paciente necessita de afastamento de suas atividades por 2 (dois) dias a partir desta data."
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={withCid}
                onChange={(e) => setWithCid(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Incluir CID
            </label>
            {withCid ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[140px_1fr]">
                <Input
                  placeholder="CID (ex.: H52.1)"
                  value={cidCode}
                  onChange={(e) => setCidCode(e.target.value)}
                />
                <Input
                  placeholder="Descrição do CID (opcional)"
                  value={cidDescription}
                  onChange={(e) => setCidDescription(e.target.value)}
                />
              </div>
            ) : null}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="text-[11px] font-bold uppercase text-slate-500">Papel</Label>
                <Select
                  value={paperSize}
                  onValueChange={(v) => setPaperSize(v as 'A4' | 'A5' | 'LETTER')}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A4">A4</SelectItem>
                    <SelectItem value="A5">A5</SelectItem>
                    <SelectItem value="LETTER">Carta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px] font-bold uppercase text-slate-500">Fonte</Label>
                <Input
                  type="number"
                  min={8}
                  max={18}
                  value={fontSize}
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value))
                    if (Number.isFinite(n)) setFontSize(Math.min(18, Math.max(8, n)))
                  }}
                  className="w-20"
                />
              </div>
            </div>
            {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}
            <Button type="button" size="sm" onClick={emit} disabled={pending} className="gap-2">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Emitir documento
            </Button>
          </div>
        ) : null}

        {loading ? (
          <p className="py-3 text-center text-xs text-slate-500">Carregando…</p>
        ) : docs.length === 0 ? (
          <p className="py-3 text-center text-xs text-slate-500">Nenhum documento emitido.</p>
        ) : (
          <ul className="space-y-1.5">
            {docs.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                  {TYPE_LABEL[d.docType]}
                </span>
                <span className="flex-1 font-semibold text-slate-800">{d.title}</span>
                {d.cidCode ? (
                  <span className="rounded bg-info-bg px-1.5 py-0.5 text-[10px] font-bold text-info-text">
                    CID {d.cidCode}
                  </span>
                ) : null}
                {d.issuedAt ? (
                  <span className="text-[10px] font-semibold text-slate-400">baixado</span>
                ) : null}
                {canWrite ? (
                  <button
                    type="button"
                    onClick={() => void toggleDelivered(d.id, d.deliveredAt !== null)}
                    title={
                      d.deliveredAt
                        ? 'Entregue ao paciente — clique para desfazer'
                        : 'Marcar como entregue ao paciente'
                    }
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      d.deliveredAt
                        ? 'bg-success-bg text-success-text'
                        : 'border border-slate-200 text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    <Check className="h-3 w-3" /> {d.deliveredAt ? 'Entregue' : 'Entregar'}
                  </button>
                ) : d.deliveredAt ? (
                  <span className="inline-flex items-center gap-1 rounded bg-success-bg px-1.5 py-0.5 text-[10px] font-bold text-success-text">
                    <Check className="h-3 w-3" /> Entregue
                  </span>
                ) : null}
                <span className="whitespace-nowrap text-slate-400">{formatDate(d.createdAt)}</span>
                <a
                  href={`/api/pacientes/${patientId}/documentos/${d.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-link hover:underline"
                >
                  <Download className="h-3.5 w-3.5" /> PDF
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}
