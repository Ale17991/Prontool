'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppointmentDetailDTO, AppointmentDetailState } from './types'

/**
 * Hook que carrega `GET /api/atendimentos/{id}` no client.
 *
 * - `id === null` ⇒ não busca, estado `{ data: null, loading: false, error: null }`.
 * - Mudança de `id` cancela request anterior via `AbortController` (FR-011).
 * - Mapeia 401/403/404/5xx para `error.code` legível pelo Panel.
 * - Expõe `refetch()` para os forms chamarem após ação bem-sucedida.
 */
export function useAppointmentDetail(id: string | null): AppointmentDetailState & {
  refetch: () => void
} {
  const [state, setState] = useState<AppointmentDetailState>({
    data: null,
    loading: false,
    error: null,
  })
  const [refreshTick, setRefreshTick] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!id) {
      // Cancela qualquer pendente.
      abortRef.current?.abort()
      abortRef.current = null
      setState({ data: null, loading: false, error: null })
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setState((prev) => ({ data: prev.data, loading: true, error: null }))

    fetch(`/api/atendimentos/${id}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: { code?: string; message?: string }
          } | null
          const code = body?.error?.code ?? `HTTP_${res.status}`
          const message = mapErrorMessage(res.status, body?.error?.message)
          throw { code, message }
        }
        return (await res.json()) as AppointmentDetailDTO
      })
      .then((data) => {
        if (ctrl.signal.aborted) return
        setState({ data, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        if (
          err &&
          typeof err === 'object' &&
          'name' in err &&
          (err as { name: string }).name === 'AbortError'
        ) {
          return
        }
        const e = err as { code?: string; message?: string }
        setState({
          data: null,
          loading: false,
          error: {
            code: e.code,
            message: e.message ?? 'Falha ao carregar atendimento.',
          },
        })
      })

    return () => {
      ctrl.abort()
    }
  }, [id, refreshTick])

  const refetch = useCallback(() => {
    setRefreshTick((n) => n + 1)
  }, [])

  return { ...state, refetch }
}

function mapErrorMessage(status: number, serverMessage?: string): string {
  if (status === 401) return 'Sessão expirada. Recarregue a página para entrar novamente.'
  if (status === 403) return 'Você não tem permissão para ver este atendimento.'
  if (status === 404) return 'Atendimento não encontrado.'
  if (status >= 500) return 'O servidor falhou. Tente novamente.'
  return serverMessage ?? 'Não foi possível carregar o atendimento.'
}
