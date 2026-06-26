'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, Loader2, LogOut } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser'

/**
 * Feature 043 (US5) — banner fixo quando o super-admin está impersonando uma
 * clínica em modo somente-leitura. "Sair" encerra a impersonação (restaura o
 * contexto de plataforma) e volta ao /admin.
 */
export function ImpersonationBanner({ clinicName }: { clinicName: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function exit() {
    setBusy(true)
    try {
      await fetch('/api/admin/impersonation/end', { method: 'POST' })
      const sb = createSupabaseBrowserClient()
      await sb.auth.refreshSession()
      router.push('/admin/clinicas')
      router.refresh()
    } catch {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.12)] px-4 py-2">
      <span className="flex items-center gap-2 text-xs font-semibold text-[hsl(var(--warning-foreground))]">
        <Eye className="h-4 w-4" />
        Modo suporte (somente-leitura){clinicName ? ` — ${clinicName}` : ''}. Nenhuma alteração é
        permitida.
      </span>
      <button
        type="button"
        onClick={() => void exit()}
        disabled={busy}
        className="inline-flex h-7 items-center gap-1.5 rounded-md bg-slate-900 px-2.5 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
        Sair da clínica
      </button>
    </div>
  )
}
