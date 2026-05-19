'use client'

import { useEffect, useRef, useState } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string
          callback: (token: string) => void
          'error-callback'?: () => void
          'expired-callback'?: () => void
          theme?: 'light' | 'dark' | 'auto'
          size?: 'normal' | 'compact' | 'invisible'
          appearance?: 'always' | 'execute' | 'interaction-only'
        },
      ) => string
      reset: (widgetId?: string) => void
      remove: (widgetId?: string) => void
    }
    onTurnstileLoad?: () => void
  }
}

interface TurnstileWidgetProps {
  onToken: (token: string) => void
  onExpired?: () => void
  onError?: () => void
}

/**
 * Renderiza Cloudflare Turnstile (invisible mode). Carrega o script async.
 * Em ambiente sem `NEXT_PUBLIC_TURNSTILE_SITE_KEY` configurado, NÃO renderiza
 * nada (dev). O server-side `verifyTurnstile` faz bypass equivalente.
 */
export function TurnstileWidget({
  onToken,
  onExpired,
  onError,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const [bypass, setBypass] = useState(false)
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  useEffect(() => {
    if (!siteKey) {
      // Dev / sem captcha — UX equivalente: emite token vazio uma vez.
      setBypass(true)
      onToken('dev-bypass')
      return
    }

    // Injeta script se ainda não está presente.
    const SCRIPT_ID = 'cf-turnstile-script'
    if (!document.getElementById(SCRIPT_ID)) {
      const s = document.createElement('script')
      s.id = SCRIPT_ID
      s.src =
        'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad'
      s.async = true
      s.defer = true
      document.head.appendChild(s)
    }

    const render = () => {
      if (!containerRef.current || !window.turnstile) return
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        size: 'normal',
        callback: onToken,
        'expired-callback': onExpired,
        'error-callback': onError,
      })
    }

    if (window.turnstile) {
      render()
    } else {
      window.onTurnstileLoad = render
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // ignore
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey])

  if (bypass) {
    return (
      <p className="text-xs text-slate-400">
        Captcha desativado em desenvolvimento.
      </p>
    )
  }

  return <div ref={containerRef} />
}
