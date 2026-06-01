'use client'

/* eslint-disable no-console -- logs `[memed]` são diagnóstico intencional do
   SDK externo da Memed no navegador (timing de boot do iframe). */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pill } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Feature 026 (US1/US3) — Launcher de prescrição digital.
 *
 * Fluxo: busca o token do prescritor (proxy) + o payload do paciente
 * (decifrado server-side), carrega o script da Memed com `data-token`, espera
 * o SDK (`MdSinapsePrescricao`/`MdHub`) ficar pronto via polling, faz
 * `setPaciente`, abre o módulo e liga os eventos `prescricaoImpressa`/
 * `prescricaoExcluida` às rotas de registro.
 *
 * As chaves NUNCA passam por aqui — só o token curto do prescritor.
 *
 * ⚠️ Integra o SDK externo da Memed (`MdHub`). Como o script boota de forma
 * assíncrona (mesmo após `onload`), NÃO confiamos só no evento one-shot
 * `core:moduleInit` — fazemos polling do `MdHub` e mandamos `setPaciente`
 * defensivamente. Logs no console (`[memed]`) ajudam a diagnosticar.
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
    window.MdHub = undefined

    const script = document.createElement('script')
    script.id = MEMED_SCRIPT_ID
    script.src = MEMED_SCRIPT_SRC
    script.dataset.token = token
    script.dataset.color = '#2563eb'
    script.async = true
    script.onload = () => {
      console.info('[memed] script onload OK')
      resolve()
    }
    script.onerror = () => {
      console.error('[memed] falha ao carregar o script', MEMED_SCRIPT_SRC)
      reject(new Error('Não foi possível carregar o módulo da Memed (script bloqueado ou offline).'))
    }
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
  const [debug, setDebug] = useState<string | null>(null)
  const eventsBoundRef = useRef(false)
  const loading = stage !== null

  const recordIssued = useCallback(
    async (data: unknown) => {
      console.info('[memed] evento prescricaoImpressa', data)
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
      console.info('[memed] evento prescricaoExcluida', data)
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
      console.info('[memed] eventos prescricaoImpressa/Excluida registrados')
    },
    [recordIssued, recordDeleted],
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
    setStage('Carregando dados do paciente…')
    setError(null)
    try {
      console.info('[memed] buscando token + paciente')
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
      console.info('[memed] token e paciente OK; carregando script')

      setStage('Carregando módulo Memed…')
      await loadMemedScript(token)

      // Diagnóstico: revela os nomes reais dos globais que a Memed cria
      // (caso o hub não seja exatamente `window.MdHub`). Mostra na TELA
      // (abaixo do botão) para não depender do filtro do Console.
      const memedGlobals = () =>
        Object.keys(window).filter((k) => /md|memed|sinapse|hub|prescri/i.test(k))
      const dumpGlobals = (when: string) => {
        const g = memedGlobals()
        console.info(`[memed] globals (${when}):`, g)
        setDebug(`globais Memed (${when}): ${g.length ? g.join(', ') : '(nenhum)'}`)
      }
      dumpGlobals('apos onload')
      setTimeout(() => dumpGlobals('apos 3s'), 3000)

      // Registra o moduleInit ASSIM QUE o event bus existir (envia setPaciente
      // quando o módulo de prescrição inicializa).
      setStage('Inicializando módulo…')
      const sinapse = await waitFor(() => window.MdSinapsePrescricao, SDK_TIMEOUT_MS, 'MdSinapsePrescricao')
      sinapse.event.add('core:moduleInit', (module) => {
        console.info('[memed] core:moduleInit', module?.name)
        if (module?.name !== PRESCRICAO_MODULE) return
        const hub = window.MdHub
        if (!hub) return
        bindEvents(hub)
        hub.command.send(PRESCRICAO_MODULE, 'setPaciente', paciente)
      })

      // Espera o MdHub e abre o módulo.
      const hub = await waitFor(() => window.MdHub, SDK_TIMEOUT_MS, 'MdHub')
      bindEvents(hub)
      console.info('[memed] abrindo módulo de prescrição')
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
      console.error('[memed] falha no launcher', err)
      setStage(null)
      setError(err instanceof Error ? err.message : 'Falha ao abrir a prescrição.')
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={handlePrescrever} disabled={loading} className="gap-2">
        <Pill className="h-4 w-4" />
        {stage ?? 'Prescrever'}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {debug ? (
        <p className="break-all rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-600">
          {debug}
        </p>
      ) : null}
    </div>
  )
}
