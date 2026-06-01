'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pill } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Feature 026 (US1/US3) — Launcher de prescrição digital.
 *
 * Fluxo: busca o token do prescritor (proxy) + o payload do paciente
 * (decifrado server-side), carrega o script da Memed com `data-token`, aguarda
 * `core:moduleInit`, faz `setPaciente`, abre o módulo de prescrição e liga os
 * eventos `prescricaoImpressa`/`prescricaoExcluida` às rotas de registro.
 *
 * As chaves NUNCA passam por aqui — só o token curto do prescritor.
 *
 * ⚠️ Integra o SDK externo da Memed (`MdHub`). A API do iframe e o formato dos
 * eventos devem ser confirmados contra a homologação da Memed; o parsing de id
 * é defensivo para tolerar variações de payload.
 */

const MEMED_SCRIPT_ID = 'memed-sinapse-script'
const MEMED_SCRIPT_SRC =
  'https://integrations.memed.com.br/modulos/plataforma.sinapse-prescricao/build/sinapse-prescricao.min.js'
const PRESCRICAO_MODULE = 'plataforma.prescricao'

interface MdHubLike {
  command: { send: (...args: unknown[]) => void }
  event: { add: (event: string, cb: (data: unknown) => void) => void }
  module: { show: (name: string) => void }
}
interface MdSinapseLike {
  event: { add: (event: string, cb: (module: { name?: string }) => void) => void }
}

declare global {
  interface Window {
    MdSinapsePrescricao?: MdSinapseLike
    MdHub?: MdHubLike
  }
}

interface ApiError {
  error?: { code?: string; message?: string }
}

function extractPrescriptionId(data: unknown): string | null {
  if (data === null || data === undefined) return null
  if (typeof data === 'string' || typeof data === 'number') return String(data)
  if (typeof data === 'object') {
    const d = data as Record<string, unknown>
    const nested = d.prescricao
    const fromNested =
      nested && typeof nested === 'object'
        ? (nested as Record<string, unknown>).id
        : undefined
    const candidate = d.id ?? fromNested ?? d.prescriptionId ?? d.idPrescricao
    if (candidate !== null && candidate !== undefined) return String(candidate)
  }
  return null
}

function loadMemedScript(token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Recarrega com o token atual (o script lê `data-token` no load).
    const previous = document.getElementById(MEMED_SCRIPT_ID)
    if (previous) previous.remove()
    window.MdSinapsePrescricao = undefined
    window.MdHub = undefined

    const script = document.createElement('script')
    script.id = MEMED_SCRIPT_ID
    script.src = MEMED_SCRIPT_SRC
    script.dataset.token = token
    script.dataset.color = '#2563eb'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Não foi possível carregar o módulo da Memed.'))
    document.body.appendChild(script)
  })
}

export function PrescreverLauncher({
  appointmentId,
  doctorId,
  onRecorded,
}: {
  appointmentId: string
  doctorId: string
  /** Chamado após registrar emissão/exclusão — usado pelo sheet para refetch. */
  onRecorded?: () => void
}): JSX.Element {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const eventsBoundRef = useRef(false)

  const recordIssued = useCallback(
    async (data: unknown) => {
      const memedId = extractPrescriptionId(data)
      if (!memedId) return
      await fetch(`/api/atendimentos/${appointmentId}/prescricoes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memed_prescription_id: memedId, doctor_id: doctorId }),
      }).catch(() => {})
      onRecorded?.()
      router.refresh()
    },
    [appointmentId, doctorId, router, onRecorded],
  )

  const recordDeleted = useCallback(
    async (data: unknown) => {
      const memedId = extractPrescriptionId(data)
      if (!memedId) return
      await fetch(`/api/atendimentos/${appointmentId}/prescricoes/${encodeURIComponent(memedId)}`, {
        method: 'PATCH',
      }).catch(() => {})
      onRecorded?.()
      router.refresh()
    },
    [appointmentId, router, onRecorded],
  )

  // Logout do prescritor ao desmontar (troca de atendimento/saída da página).
  useEffect(() => {
    return () => {
      try {
        window.MdHub?.command.send(PRESCRICAO_MODULE, 'logout')
      } catch {
        /* módulo pode não ter carregado */
      }
    }
  }, [])

  async function handlePrescrever() {
    setStatus('loading')
    setError(null)
    try {
      const [tokenRes, pacRes] = await Promise.all([
        fetch(`/api/medicos/${doctorId}/memed-token`),
        fetch(`/api/atendimentos/${appointmentId}/memed-paciente`),
      ])
      if (!tokenRes.ok) {
        const body = (await tokenRes.json().catch(() => ({}))) as ApiError
        throw new Error(body.error?.message ?? `Erro ao obter token (${tokenRes.status})`)
      }
      if (!pacRes.ok) {
        const body = (await pacRes.json().catch(() => ({}))) as ApiError
        throw new Error(body.error?.message ?? `Erro ao carregar paciente (${pacRes.status})`)
      }
      const { token } = (await tokenRes.json()) as { token: string }
      const { paciente } = (await pacRes.json()) as { paciente: unknown }

      await loadMemedScript(token)

      const sinapse = window.MdSinapsePrescricao
      if (!sinapse) throw new Error('Módulo da Memed não inicializou.')

      sinapse.event.add('core:moduleInit', (module) => {
        if (module?.name !== PRESCRICAO_MODULE) return
        const hub = window.MdHub
        if (!hub) return
        if (!eventsBoundRef.current) {
          hub.event.add('prescricaoImpressa', (data) => void recordIssued(data))
          hub.event.add('prescricaoExcluida', (data) => void recordDeleted(data))
          eventsBoundRef.current = true
        }
        hub.command.send(PRESCRICAO_MODULE, 'setPaciente', paciente)
        hub.module.show(PRESCRICAO_MODULE)
        setStatus('ready')
      })
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Falha ao abrir a prescrição.')
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={handlePrescrever} disabled={status === 'loading'} className="gap-2">
        <Pill className="h-4 w-4" />
        {status === 'loading' ? 'Abrindo prescrição…' : 'Prescrever'}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
