import type { ReactNode } from 'react'
import { SessionKeepAlive } from '@/components/patient-portal/session-keep-alive'

/**
 * Feature 057 — layout do painel do portal.
 *
 * Existe por um motivo só: pendurar a renovação da sessão em TODA área do
 * painel, inclusive nas que ainda vão nascer, sem repetir a chamada em cada
 * página. Fica abaixo de `/paciente/[slug]` para não alcançar a tela de login,
 * onde não há sessão para renovar.
 */
export default function PainelLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SessionKeepAlive />
      {children}
    </>
  )
}
