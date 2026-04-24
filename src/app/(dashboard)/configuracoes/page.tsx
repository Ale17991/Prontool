import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Plug, Settings } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export default async function ConfiguracoesPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <Settings className="h-6 w-6 text-primary" />
          Configurações
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Administração do tenant, integrações externas e preferências.
        </p>
      </div>

      {session.role === 'admin' ? (
        <Link
          href="/configuracoes/integracoes"
          className="group block rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Plug className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">Integrações</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Conectar e desconectar plataformas externas: GoHighLevel, HubSpot, RD Station,
                  Pipedrive e webhooks genéricos. Por tenant, com auditoria.
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </div>
        </Link>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Outras configurações</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500">
              Apenas administradores do tenant podem ajustar configurações.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
