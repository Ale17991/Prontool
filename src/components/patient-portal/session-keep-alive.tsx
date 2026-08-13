'use client'

import { useEffect } from 'react'

/**
 * Feature 057 — mantém a sessão viva enquanto o paciente navega.
 *
 * Uma chamada por página aberta, que empurra a janela de 30 minutos de
 * inatividade. Fica no layout do painel para valer em toda área — inclusive nas
 * que ainda não existem — e ficar de fora da tela de login, onde não há sessão
 * para renovar.
 *
 * Sem JavaScript, nada acontece e a sessão volta a durar 30 minutos fixos: o
 * portal degrada para o comportamento anterior à 057, que é seguro. O contrário
 * — a sessão morrer no meio de uma navegação — é que seria regressão.
 *
 * Não trata erro de propósito: falhar em renovar não é evento para o paciente.
 * Se a sessão de fato caiu, a próxima página já o devolve ao login com aviso.
 */
export function SessionKeepAlive() {
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/paciente/sessao', {
      method: 'POST',
      signal: controller.signal,
    }).catch(() => {})
    return () => controller.abort()
  }, [])

  return null
}
