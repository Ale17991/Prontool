# Contract — Routes

**Feature**: Sidebar enxuta + Configurações como hub
**Branch**: `014-sidebar-config-hub`

Esta feature é puramente de navegação. Os "contratos" são contratos de **rotas Next.js** (não APIs HTTP). Definem: rotas novas, rotas mantidas, rotas que viram redirect, e o status HTTP esperado.

---

## Rotas afetadas

| URL | Status HTTP | Tipo | Notas |
|-----|------------|------|-------|
| `/configuracoes` | 200 | **ALTERADA** | Era redirect role-based (admin → `/configuracoes/clinica`; outros → `/configuracoes/perfil`). Vira hub com grid de cards. |
| `/configuracoes/auditoria` | 200 | **NOVA** | Página de auditoria, código movido de `/analise/auditoria`. |
| `/configuracoes/clinica` | 200 | MANTIDA | Sem mudança. |
| `/configuracoes/perfil` | 200 | MANTIDA | Sem mudança. |
| `/configuracoes/usuarios` | 200 | MANTIDA | Sem mudança. |
| `/configuracoes/procedimentos` | 200 | MANTIDA | Sem mudança. |
| `/configuracoes/convenios` | 200 | MANTIDA | Sem mudança. |
| `/configuracoes/profissionais` | 200 | MANTIDA | Sem mudança. |
| `/configuracoes/modelos-anamnese` | 200 | MANTIDA | Sem mudança. |
| `/configuracoes/integracoes` | 200 | MANTIDA | Sem mudança. |
| `/operacao/notificacoes` | 200 | **ALTERADA** | Aceita `?tab=notificacoes|alertas|dlq`. Renderiza sub-seções server-side. |
| `/operacao/alertas` | **308** | **VIRA REDIRECT** | `Location: /operacao/notificacoes?tab=alertas[&<original-query-preserved>]` |
| `/operacao/dlq` | **308** | **VIRA REDIRECT** | `Location: /operacao/notificacoes?tab=dlq[&<original-query-preserved>]` |
| `/analise/auditoria` | **308** | **VIRA REDIRECT** | `Location: /configuracoes/auditoria[?<original-query-preserved>]` |

---

## Contrato detalhado

### 1. `/configuracoes` — Hub (substituição do redirect role-based)

**Antes**:
```ts
if (session.role === 'admin') redirect('/configuracoes/clinica')
else redirect('/configuracoes/perfil')
```

**Depois**:
- Server Component que carrega sessão + flags, filtra `HUB_CARDS` por `show(ctx)`, e renderiza um grid (1/2/3 colunas).
- Status HTTP: **200** (sem redirect; é uma página).
- Visibilidade dos cards: aplicada **no servidor** antes da resposta — flash de cards proibidos é impossível (FR-017).
- Cada card é um `<Link>` para `card.href`. Sem fetch client-side. Sem hidratação extra além do que outras páginas SSR têm.

**Acceptance**:
- Admin com todas flags `true` vê 9 cards na ordem fixa.
- Profissional de saúde (sem flags relevantes) vê apenas 1 card: "Meu Perfil".
- HTML contém apenas os cards que passaram pelo filtro — não há CSS `display: none`.

---

### 2. `/operacao/notificacoes` — Página unificada com tabs

**Antes**:
- Página renderizava só notificações pessoais + um link "Alertas do sistema" que navegava para `/operacao/alertas`.

**Depois**:
- Server Component lê `searchParams.tab`. Se ausente ou inválido, default = `notificacoes`.
- Tab bar é renderizada como `<nav aria-label="Seções de notificações">` com `<Link>` para cada aba **disponível para o usuário**.
- Conteúdo do `<main>` é determinado pela aba ativa:
  - `notificacoes`: lista de `notifications` (queries existentes).
  - `alertas`: lista de `alerts` (mesmo conteúdo de `/operacao/alertas` hoje — código movido para um componente compartilhado ou inline na page).
  - `dlq`: lista de itens DLQ (mesmo conteúdo de `/operacao/dlq` hoje).
- Se `?tab=alertas` mas o usuário não tem `alert.read`, **cai silenciosamente** para `notificacoes` (não 403, não banner — apenas renderiza a aba padrão).
- Idem para `?tab=dlq` sem `dlq.read`.

**Acceptance**:
- Recepcionista (`alert.read` = false, `dlq.read` = false): tab bar mostra apenas "Notificações". Acesso a `?tab=alertas` cai em notificações silenciosamente.
- Admin (`alert.read` = true, `dlq.read` = true): tab bar mostra 3 abas. Cada `?tab=...` válido renderiza a aba correspondente.
- Funcionalidades existentes em cada aba (marcar como lido, resolver alerta, reprocessar DLQ) **continuam funcionando** com seus mesmos handlers de API (FR-015).

---

### 3. Redirects (HTTP 308)

Todos os três redirects são **permanentes** (308) e preservam query strings. Implementação:

```ts
// /analise/auditoria/page.tsx (exemplo)
import { permanentRedirect } from 'next/navigation'

export default function LegacyAuditoriaRedirect({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === 'string') qs.set(k, v)
  }
  const dest = qs.toString()
    ? `/configuracoes/auditoria?${qs.toString()}`
    : '/configuracoes/auditoria'
  permanentRedirect(dest)
}
```

**Para `/operacao/alertas`**: destino base = `/operacao/notificacoes?tab=alertas`. Query strings adicionais do usuário são anexadas após `tab`.

**Para `/operacao/dlq`**: destino base = `/operacao/notificacoes?tab=dlq`. Idem.

**Acceptance** (verificável em integration test):
- `GET /analise/auditoria` → `308`, `Location: /configuracoes/auditoria`.
- `GET /analise/auditoria?from=2026-01-01&to=2026-01-31` → `308`, `Location: /configuracoes/auditoria?from=2026-01-01&to=2026-01-31`.
- `GET /operacao/alertas?severity=warning` → `308`, `Location: /operacao/notificacoes?tab=alertas&severity=warning`.
- `GET /operacao/dlq` → `308`, `Location: /operacao/notificacoes?tab=dlq`.

**RBAC**: o redirect NÃO valida permissão — apenas mapeia URL. A página de destino faz seu próprio check (mesma cadeia que hoje).

---

## O que NÃO muda

- Nenhum endpoint `/api/*` é tocado (FR-016).
- Nenhuma rota dentro de `/configuracoes/*` (exceto `/`) muda forma — clínica, perfil, usuários, etc. continuam idênticos.
- Nenhum middleware (`middleware.ts`) é alterado.
- Nenhuma config em `next.config.js` é alterada.

---

## Status

Contract finalizado. Implementação será coberta em `tasks.md` (gerado por `/speckit.tasks`).
