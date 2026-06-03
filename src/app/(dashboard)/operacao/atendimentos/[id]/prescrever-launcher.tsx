'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pill } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Feature 026 (US1/US3) — Launcher de prescrição digital.
 *
 * Fluxo: busca o token do prescritor (proxy) + o payload do paciente
 * (decifrado server-side), carrega o script da Memed com `data-token`, espera
 * o SDK ficar pronto, faz `setPaciente`, abre o módulo e liga os eventos
 * `prescricaoImpressa`/`prescricaoExcluida` às rotas de registro.
 *
 * As chaves NUNCA passam por aqui — só o token curto do prescritor.
 *
 * Notas de integração com o SDK externo:
 *  - O script boota de forma assíncrona mesmo após `onload`; esperamos os
 *    globais por polling (com timeout) em vez de confiar só no evento one-shot
 *    `core:moduleInit`.
 *  - `MdSinapsePrescricao` é exposto em `window`; `MdHub` é um GLOBAL LÉXICO
 *    (let/const no escopo global), acessível por nome simples — NÃO é
 *    `window.MdHub`. Por isso lemos via `getMdHub()`.
 */

const MEMED_SCRIPT_ID = 'memed-sinapse-script'
const MEMED_SCRIPT_SRC =
  'https://integrations.memed.com.br/modulos/plataforma.sinapse-prescricao/build/sinapse-prescricao.min.js'
const PRESCRICAO_MODULE = 'plataforma.prescricao'
const SDK_TIMEOUT_MS = 20_000

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
  }
}

// `MdHub` é global léxico da Memed (não vive em `window`).
declare const MdHub: MdHubLike | undefined

/** Lê o `MdHub` léxico com segurança (typeof não lança para nome inexistente). */
function getMdHub(): MdHubLike | undefined {
  try {
    return typeof MdHub !== 'undefined' && MdHub ? MdHub : undefined
  } catch {
    return undefined
  }
}

interface ApiError {
  error?: { code?: string; message?: string; meta?: { missing?: string[] } }
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

/** Aguarda um global aparecer (script boota async). Rejeita após timeout. */
function waitFor<T>(getter: () => T | undefined | null, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      const value = getter()
      if (value) {
        resolve(value)
        return
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timeout aguardando ${label} da Memed.`))
        return
      }
      setTimeout(tick, 150)
    }
    tick()
  })
}

function loadMemedScript(token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const previous = document.getElementById(MEMED_SCRIPT_ID)
    if (previous) previous.remove()
    window.MdSinapsePrescricao = undefined

    const script = document.createElement('script')
    script.id = MEMED_SCRIPT_ID
    script.src = MEMED_SCRIPT_SRC
    script.dataset.token = token
    script.dataset.color = '#2563eb'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () =>
      reject(new Error('Não foi possível carregar o módulo da Memed (script bloqueado ou offline).'))
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
  const [stage, setStage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Quando o paciente não tem os campos obrigatórios para prescrever, listamos
  // o que falta num aviso acima do botão (em vez de um erro genérico).
  const [missingFields, setMissingFields] = useState<string[] | null>(null)
  const eventsBoundRef = useRef(false)
  const loading = stage !== null

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

  const bindEvents = useCallback(
    (hub: MdHubLike) => {
      if (eventsBoundRef.current) return
      hub.event.add('prescricaoImpressa', (data) => void recordIssued(data))
      hub.event.add('prescricaoExcluida', (data) => void recordDeleted(data))
      eventsBoundRef.current = true
    },
    [recordIssued, recordDeleted],
  )

  // Logout do prescritor ao desmontar (troca de atendimento/saída da página).
  useEffect(() => {
    return () => {
      try {
        getMdHub()?.command.send(PRESCRICAO_MODULE, 'logout')
      } catch {
        /* módulo pode não ter carregado */
      }
    }
  }, [])

  async function handlePrescrever() {
    setStage('Carregando dados do paciente…')
    setError(null)
    setMissingFields(null)
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
        // Paciente sem os campos obrigatórios → aviso amigável acima do botão.
        if (pacRes.status === 422 && body.error?.code === 'MEMED_PATIENT_FIELDS_MISSING') {
          setMissingFields(body.error?.meta?.missing ?? [])
          setStage(null)
          return
        }
        throw new Error(body.error?.message ?? `Erro ao carregar paciente (${pacRes.status})`)
      }
      const { token } = (await tokenRes.json()) as { token: string }
      const { paciente } = (await pacRes.json()) as { paciente: unknown }

      setStage('Carregando módulo Memed…')
      await loadMemedScript(token)

      setStage('Inicializando módulo…')
      const sinapse = await waitFor(() => window.MdSinapsePrescricao, SDK_TIMEOUT_MS, 'MdSinapsePrescricao')
      sinapse.event.add('core:moduleInit', (module) => {
        if (module?.name !== PRESCRICAO_MODULE) return
        const hub = getMdHub()
        if (!hub) return
        bindEvents(hub)
        hub.command.send(PRESCRICAO_MODULE, 'setPaciente', paciente)
      })

      const hub = await waitFor(() => getMdHub(), SDK_TIMEOUT_MS, 'MdHub')
      bindEvents(hub)
      hub.module.show(PRESCRICAO_MODULE)
      // Defensivo: se o moduleInit já tinha passado, manda o paciente direto.
      setTimeout(() => {
        try {
          hub.command.send(PRESCRICAO_MODULE, 'setPaciente', paciente)
        } catch {
          /* ignore */
        }
      }, 800)

      setStage(null)
    } catch (err) {
      setStage(null)
      setError(err instanceof Error ? err.message : 'Falha ao abrir a prescrição.')
    }
  }

  return (
    <div className="space-y-2">
      {missingFields ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-semibold">
            Falta{missingFields.length > 1 ? 'm' : ''} algum(ns) dos campos obrigatórios para a
            prescrição.
          </p>
          <p className="mt-1">Por favor, atualize a ficha do paciente.</p>
          {missingFields.length > 0 ? (
            <p className="mt-1">
              Faltando: <strong>{missingFields.join(', ')}</strong>.
            </p>
          ) : null}
          <p className="mt-1 text-amber-700">
            Campos obrigatórios para prescrever: nome, CPF, e-mail, celular e data de nascimento.
          </p>
        </div>
      ) : null}
      <Button onClick={handlePrescrever} disabled={loading} className="gap-2">
        <Pill className="h-4 w-4" />
        {stage ?? 'Prescrever'}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
