'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import {
  ArrowLeftRight,
  Lock,
  Menu,
  Search,
  Stethoscope,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser'
import { listFeatureFlags } from '@/lib/feature-flags'
import type { TenantRole } from '@/lib/db/types'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import {
  SidebarIntegrationsBadge,
  type SidebarIntegrationBadgeItem,
} from './sidebar-integrations-badge'
import { NotificationBell } from './notification-bell'
import { SupportTicketDialog } from './support-ticket-dialog'
import {
  getVisibleSections,
  type NavContext,
  type VisibleSection,
} from './sidebar-sections'

/**
 * Feature 014 — sidebar enxugada para 3 + 3 + 1 itens (Operação,
 * Análise, e botão único Configurações). Notificações, Alertas e
 * Pendências moveram para /operacao/notificacoes (tab bar acessada pelo
 * sininho); Auditoria moveu para /configuracoes/auditoria (acessada pelo
 * hub). A configuração concreta vive em `sidebar-sections.ts` para ser
 * testável em ambiente node.
 */

interface DashboardShellProps {
  role: TenantRole
  email: string | null
  integrations?: SidebarIntegrationBadgeItem[]
  /** Feature 009 — URL assinada da logo da clínica (24 h). null = fallback. */
  clinicLogoUrl?: string | null
  /**
   * Feature 010 (US3 / R13) — tenants.name (display name). Cai para
   * corporate_name e por fim "Clinni" como último recurso.
   */
  clinicName?: string | null
  /** Feature 010 (US3) — usuário tem >1 tenant ativo? Mostra "Trocar clínica". */
  isMultiTenant?: boolean
  /** Feature 009 — URL assinada do avatar do usuário (24 h). null = iniciais. */
  userAvatarUrl?: string | null
  /** Feature 009 — nome completo. null = fallback para email. */
  userFullName?: string | null
  children: ReactNode
}

export function DashboardShell({
  role,
  email,
  integrations = [],
  clinicLogoUrl = null,
  clinicName = null,
  isMultiTenant = false,
  userAvatarUrl = null,
  userFullName = null,
  children,
}: DashboardShellProps) {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const flags = listFeatureFlags()
  const ctx: NavContext = { role, flags }
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  // Defensa em profundidade contra falha silenciosa do path SSR. Se o
  // server-side disser que isMultiTenant=false, ainda assim consultamos
  // /api/auth/me/tenants do cliente — essa rota usa o mesmo
  // createSupabaseServiceClient e o mesmo getAvailableTenants, mas
  // independe do prefetch do layout (que pode ter falhado silenciosamente,
  // ex.: SUPABASE_SERVICE_ROLE_KEY ausente, cache de build velho, etc.).
  // Se a API confirmar ≥ 2 tenants, ligamos o link via state local.
  const [clientMultiTenant, setClientMultiTenant] = useState(false)
  useEffect(() => {
    if (isMultiTenant) return // SSR já disse sim — não precisa checar
    let cancelled = false
    fetch('/api/auth/me/tenants', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body) return
        const tenants = body.tenants
        if (Array.isArray(tenants) && tenants.length > 1) {
          setClientMultiTenant(true)
        }
      })
      .catch(() => {
        // silencioso — pior caso o link continua escondido
      })
    return () => {
      cancelled = true
    }
  }, [isMultiTenant])

  const effectiveMultiTenant = isMultiTenant || clientMultiTenant

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      const supabase = createSupabaseBrowserClient()
      await supabase.auth.signOut()
    } catch {
      // Falha no signOut remoto não trava o redirect — middleware vê
      // sessão inválida na próxima request e força /login.
    }
    router.push('/login')
    router.refresh()
  }

  // Calcula uma vez quais seções/itens aparecem para esta sessão.
  const visibleSections = getVisibleSections(ctx)

  // Heading do header global = label do item ativo.
  const activeItem = visibleSections
    .flatMap((s) => s.visibleItems)
    .find((it) => isUnder(pathname, it.href))

  const sidebarInner = (
    <SidebarInner
      sections={visibleSections}
      pathname={pathname}
      integrations={integrations}
      email={email}
      role={role}
      clinicLogoUrl={clinicLogoUrl}
      clinicName={clinicName}
      isMultiTenant={effectiveMultiTenant}
      userAvatarUrl={userAvatarUrl}
      userFullName={userFullName}
      onNavigate={() => setDrawerOpen(false)}
    />
  )

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-100 font-sans">
      {/* Sidebar fixa (≥md) — 016: bg #0E3C5B (azul institucional do designer) */}
      <aside className="z-20 hidden w-64 shrink-0 flex-col bg-sidebar p-6 shadow-xl md:flex">
        {sidebarInner}
      </aside>

      {/* Drawer mobile (<md) */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          className="flex w-72 max-w-[80vw] flex-col bg-sidebar p-6 sm:max-w-[80vw]"
        >
          <SheetTitle className="sr-only">Navegação</SheetTitle>
          {sidebarInner}
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col bg-slate-50">
        <header className="z-10 flex h-[72px] shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Abrir menu"
              className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="truncate text-lg font-bold tracking-tight text-slate-900">
              {activeItem?.label ?? 'Painel'}
            </h1>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar paciente, atendimento…"
                className="w-64 rounded-xl border border-slate-200 bg-slate-100 py-2 pl-10 pr-4 text-xs outline-none transition-all focus:border-primary/30 focus:ring-2 focus:ring-primary/10"
              />
            </div>
            <NotificationBell />
            <div className="hidden h-6 w-px bg-slate-200 md:block" />
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex shrink-0 items-center gap-2 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95 disabled:cursor-wait disabled:opacity-60"
              title="Sair"
            >
              <Lock className="h-3 w-3" />
              <span className="hidden sm:inline">{signingOut ? 'Saindo…' : 'Sair'}</span>
            </button>
          </div>
        </header>

        {/* Feature 009 — barra de abas horizontais REMOVIDA. Cada item da
            sidebar leva direto à página final. */}

        <div className="flex-1 overflow-y-auto p-4 md:p-8">{children}</div>
      </main>
    </div>
  )
}

function SidebarInner({
  sections,
  pathname,
  integrations,
  email,
  role,
  clinicLogoUrl,
  clinicName,
  isMultiTenant,
  userAvatarUrl,
  userFullName,
  onNavigate,
}: {
  sections: VisibleSection[]
  pathname: string
  integrations: SidebarIntegrationBadgeItem[]
  email: string | null
  role: TenantRole
  clinicLogoUrl: string | null
  clinicName: string | null
  isMultiTenant: boolean
  userAvatarUrl: string | null
  userFullName: string | null
  onNavigate: () => void
}) {
  return (
    <>
      <div className="mb-8 flex flex-col gap-1.5">
        <div className="flex items-center gap-3 text-base font-bold text-white">
          {clinicLogoUrl ? (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={clinicLogoUrl} alt="Logo da clínica" className="h-full w-full object-contain" />
            </div>
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary">
              <Stethoscope className="h-5 w-5 text-white" />
            </div>
          )}
          <span className="truncate tracking-tight" title={clinicName ?? undefined}>
            {clinicName ?? 'Clinni'}
          </span>
        </div>
        {isMultiTenant ? (
          <Link
            href="/selecionar-clinica"
            onClick={onNavigate}
            className="ml-12 inline-flex items-center gap-1.5 self-start rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-sidebar-switch transition-colors hover:bg-sidebar-hover hover:opacity-80"
          >
            <ArrowLeftRight className="h-3 w-3 shrink-0" />
            <span>Trocar clínica</span>
          </Link>
        ) : null}
        <SupportTicketDialog />
      </div>

      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto">
        {sections.map((section) => (
          <div
            key={section.id}
            className={
              section.id === 'configuracoes' ? 'mt-2 border-t border-sidebar-separator pt-4' : undefined
            }
          >
            {/* Feature 014 — seção "Configurações" colapsada para botão único;
                escondemos o heading (o próprio item já se chama "Configurações")
                e adicionamos separador visual antes dela. */}
            {section.id === 'configuracoes' ? null : (
              <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-sidebar-section-label">
                {section.label}
              </div>
            )}
            <div className="flex flex-col gap-1">
              {section.visibleItems.map((it) => (
                <SidebarLink
                  key={it.href}
                  href={it.href}
                  label={it.label}
                  icon={it.icon}
                  active={isUnder(pathname, it.href)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-auto border-t border-sidebar-separator pt-6">
        <SidebarIntegrationsBadge integrations={integrations} />
        <div className="flex items-center gap-2 rounded-xl bg-white/5 p-2 text-slate-400">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-slate-800 text-xs font-bold uppercase text-white">
            {userAvatarUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={userAvatarUrl} alt="Avatar" className="h-full w-full object-cover" />
            ) : (
              (userFullName ?? email)?.slice(0, 1) ?? '?'
            )}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-xs font-semibold text-white">
              {userFullName ?? email ?? '—'}
            </p>
            <p className="truncate text-[10px] text-slate-500">{labelForRole(role)}</p>
          </div>
        </div>
      </div>
    </>
  )
}

function SidebarLink({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string
  label: string
  icon: LucideIcon
  active: boolean
  onNavigate?: () => void
}) {
  return (
    <Link
      href={href as never}
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200',
        active
          ? 'bg-sidebar-active-bg text-sidebar-active-text'
          : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white',
      )}
    >
      <Icon
        className={cn(
          'h-4 w-4 shrink-0',
          active ? 'text-sidebar-active-text' : 'opacity-80',
        )}
      />
      <span className="truncate">{label}</span>
    </Link>
  )
}

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function labelForRole(role: string): string {
  switch (role) {
    case 'admin':
      return 'Administrador'
    case 'financeiro':
      return 'Financeiro'
    case 'recepcionista':
      return 'Recepção'
    case 'profissional_saude':
      return 'Profissional de Saúde'
    default:
      return role
  }
}
