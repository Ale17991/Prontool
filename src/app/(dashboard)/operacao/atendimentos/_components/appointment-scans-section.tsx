'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Barcode, Camera, Keyboard, Loader2, ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface ScanRow {
  id: string
  barcodeFormat: string
  gtin: string | null
  lotNumber: string | null
  expirationDate: string | null
  manufacturer: string | null
  status: 'confirmed' | 'rejected' | 'expired'
  materialId: string | null
  scannedAt: string
}

function badge(s: ScanRow): { label: string; cls: string } {
  if (s.status === 'expired') return { label: 'Vencido', cls: 'bg-destructive/10 text-destructive' }
  if (s.status === 'rejected') return { label: 'Rejeitado', cls: 'bg-destructive/10 text-destructive' }
  if (!s.materialId) return { label: 'Não previsto', cls: 'bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning-foreground))]' }
  return { label: 'Confirmado', cls: 'bg-success-bg text-success-text' }
}

export function AppointmentScansSection({
  appointmentId,
  canManage,
}: {
  appointmentId: string
  canManage: boolean
}) {
  const [rows, setRows] = useState<ScanRow[]>([])
  const [scanRequired, setScanRequired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'barcode' | 'manual'>('barcode')
  const [raw, setRaw] = useState('')
  const [lot, setLot] = useState('')
  const [expiry, setExpiry] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [camOn, setCamOn] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanningRef = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/atendimentos/${appointmentId}/scans`, { cache: 'no-store' })
      if (res.ok) {
        const b = (await res.json()) as { rows: ScanRow[]; scanRequired?: boolean }
        setRows(b.rows)
        setScanRequired(Boolean(b.scanRequired))
      }
    } finally {
      setLoading(false)
    }
  }, [appointmentId])

  useEffect(() => {
    void load()
  }, [load])

  const stopCamera = useCallback(() => {
    scanningRef.current = false
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCamOn(false)
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  async function send(body: unknown): Promise<void> {
    setError(null)
    setMsg(null)
    setPending(true)
    try {
      const res = await fetch(`/api/atendimentos/${appointmentId}/scans`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const b = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        status?: string
        matched?: boolean
        reason?: string
        error?: { message?: string }
      }
      if (!res.ok) {
        setError(b.error?.message ?? 'Falha ao registrar.')
        return
      }
      if (b.status === 'duplicate') setMsg('Material já escaneado neste atendimento.')
      else if (b.status === 'expired') setMsg('⚠️ Material VENCIDO — registrado como vencido.')
      else setMsg(b.matched ? 'Material confirmado.' : 'Registrado (material não previsto).')
      setRaw('')
      await load()
    } finally {
      setPending(false)
    }
  }

  async function startCamera() {
    setError(null)
    const Detector = (window as unknown as { BarcodeDetector?: new (o: unknown) => { detect: (s: unknown) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector
    if (!Detector) {
      setError('Câmera não suportada neste navegador. Use o leitor (USB) ou digite manualmente.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      const detector = new Detector({ formats: ['data_matrix', 'code_128', 'qr_code', 'ean_13'] })
      setCamOn(true)
      scanningRef.current = true
      const tick = async () => {
        if (!scanningRef.current || !videoRef.current) return
        try {
          const codes = await detector.detect(videoRef.current)
          if (codes.length > 0 && codes[0]?.rawValue) {
            stopCamera()
            await send({ rawBarcode: codes[0].rawValue })
            return
          }
        } catch {
          /* frame sem código */
        }
        requestAnimationFrame(() => void tick())
      }
      requestAnimationFrame(() => void tick())
    } catch {
      setError('Não foi possível acessar a câmera.')
    }
  }

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600">
          <ScanLine className="h-3.5 w-3.5" /> Materiais escaneados
        </span>
        {canManage ? (
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={() => { setOpen(true); setMode('barcode'); setMsg(null); setError(null) }}>
            <Barcode className="h-3.5 w-3.5" /> Escanear material
          </Button>
        ) : null}
      </div>

      {scanRequired && rows.filter((r) => r.status === 'confirmed').length === 0 ? (
        <p className="mb-2 flex items-center gap-1.5 rounded bg-destructive/10 px-2 py-1 text-[11px] font-semibold text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> Escaneamento de material obrigatório nesta clínica.
        </p>
      ) : null}

      {loading ? (
        <p className="py-2 text-[11px] text-slate-500">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="py-2 text-[11px] text-slate-500">Nenhum material escaneado.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => {
            const b = badge(r)
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${b.cls}`}>{b.label}</span>
                <span className="flex-1 text-slate-700">
                  {r.manufacturer ? `${r.manufacturer} · ` : ''}
                  {r.gtin ? `GTIN ${r.gtin} · ` : ''}
                  {r.lotNumber ? `Lote ${r.lotNumber}` : 'sem lote'}
                  {r.expirationDate ? ` · val ${formatDate(r.expirationDate)}` : ''}
                </span>
                <span className="text-[10px] uppercase text-slate-400">{r.barcodeFormat}</span>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(o) => { if (!o) stopCamera(); setOpen(o) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Escanear material</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={mode === 'barcode' ? 'default' : 'outline'} className="gap-1.5" onClick={() => { setMode('barcode'); stopCamera() }}>
              <Barcode className="h-3.5 w-3.5" /> Código
            </Button>
            <Button type="button" size="sm" variant={mode === 'manual' ? 'default' : 'outline'} className="gap-1.5" onClick={() => { setMode('manual'); stopCamera() }}>
              <Keyboard className="h-3.5 w-3.5" /> Manual
            </Button>
          </div>

          {mode === 'barcode' ? (
            <div className="space-y-3">
              <div>
                <Label htmlFor="scan-input">Código de barras</Label>
                <Input
                  id="scan-input"
                  autoFocus
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && raw.trim()) {
                      e.preventDefault()
                      void send({ rawBarcode: raw })
                    }
                  }}
                  placeholder="Aponte o leitor USB aqui e escaneie"
                />
                <p className="mt-1 text-[11px] text-slate-500">Leitor USB preenche e confirma com Enter.</p>
              </div>
              {camOn ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video ref={videoRef} className="w-full rounded-md bg-black" muted playsInline />
              ) : null}
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={() => void send({ rawBarcode: raw })} disabled={pending || !raw.trim()} className="gap-2">
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Registrar
                </Button>
                <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => (camOn ? stopCamera() : void startCamera())}>
                  <Camera className="h-3.5 w-3.5" /> {camOn ? 'Parar câmera' : 'Usar câmera'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div><Label>Lote</Label><Input value={lot} onChange={(e) => setLot(e.target.value)} /></div>
              <div><Label>Validade</Label><Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>
              <div><Label>Fabricante</Label><Input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} /></div>
              <Button type="button" size="sm" onClick={() => void send({ manualEntry: { lot, expiry: expiry || null, manufacturer } })} disabled={pending} className="gap-2">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Registrar manualmente
              </Button>
            </div>
          )}

          {msg ? <p className="text-xs font-semibold text-slate-700">{msg}</p> : null}
          {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}
