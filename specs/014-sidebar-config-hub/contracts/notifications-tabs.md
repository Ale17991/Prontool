# Contract — Notifications Tabs

**Feature**: Sidebar enxuta + Configurações como hub
**Branch**: `014-sidebar-config-hub`

Define o contrato das abas em `/operacao/notificacoes` (FR-005, FR-006, FR-007).

---

## Abas

| id           | Label              | Default?                                         | Visibilidade              |
| ------------ | ------------------ | ------------------------------------------------ | ------------------------- |
| notificacoes | Notificações       | **SIM** (default quando `?tab` ausente/inválido) | qualquer autenticado      |
| alertas      | Alertas do sistema | não                                              | `can(role, 'alert.read')` |
| dlq          | Pendências         | não                                              | `can(role, 'dlq.read')`   |

A tab "notificacoes" é **sempre visível** (mínimo garantido para qualquer autenticado). As demais aparecem na barra de abas apenas se o usuário tem a permissão correspondente.

---

## Resolução da aba ativa

Algoritmo no Server Component (`/operacao/notificacoes/page.tsx`):

```text
1. session = await getSession()
2. requested = searchParams.tab ?? 'notificacoes'
3. permitidas = ['notificacoes']
   if (can(session.role, 'alert.read')) permitidas.push('alertas')
   if (can(session.role, 'dlq.read')) permitidas.push('dlq')
4. active = permitidas.includes(requested) ? requested : 'notificacoes'
5. Renderiza tab bar com as abas em `permitidas` (na ordem fixa: notificacoes → alertas → dlq).
6. Renderiza o conteúdo correspondente a `active`.
```

**Resultado**: nunca renderiza tab/conteúdo proibido; query `?tab` inválida cai no default silenciosamente; nenhum 403 ou redirect explícito.

---

## Tab bar (UI)

```html
<nav aria-label="Seções de notificações" class="flex gap-2 border-b border-slate-200">
  <a
    href="/operacao/notificacoes?tab=notificacoes"
    aria-current="page"  <!-- só na aba ativa -->
    class="px-3 py-2 text-sm font-medium ..."
  >Notificações</a>
  <a href="/operacao/notificacoes?tab=alertas" ...>Alertas do sistema</a>
  <a href="/operacao/notificacoes?tab=dlq" ...>Pendências</a>
</nav>
```

- `aria-current="page"` apenas no link ativo.
- Link ativo recebe estilo visualmente diferente (cor, border-bottom).
- Tabs **não visíveis** para o usuário simplesmente não aparecem no DOM (não há `display: none`).

---

## Conteúdo por aba

Cada aba renderiza **o mesmo conteúdo** que sua página standalone tinha antes:

| Aba          | Conteúdo                                                                   | Origem (código a reutilizar)                      |
| ------------ | -------------------------------------------------------------------------- | ------------------------------------------------- |
| notificacoes | Lista de notificações do usuário, com `MarkAllButton` e `NotificationItem` | Já existente em `/operacao/notificacoes/page.tsx` |
| alertas      | Lista de alertas do sistema, com `ResolveButton`                           | Mover/extrair de `/operacao/alertas/page.tsx`     |
| dlq          | Lista de itens DLQ, com `ReprocessButton`                                  | Mover/extrair de `/operacao/dlq/page.tsx`         |

> Recomenda-se extrair cada aba como **componente Server-rendered separado** dentro de `_components/` da página, ex.: `tab-notificacoes.tsx`, `tab-alertas.tsx`, `tab-dlq.tsx`. A page principal apenas resolve a aba ativa e chama o componente correspondente.

---

## Acceptance (testável)

- **A1** — Admin acessa `/operacao/notificacoes` → tab bar mostra 3 abas; aba "Notificações" ativa.
- **A2** — Admin acessa `/operacao/notificacoes?tab=alertas` → tab bar mostra 3 abas; aba "Alertas do sistema" ativa; conteúdo é o de alertas.
- **A3** — Admin acessa `/operacao/notificacoes?tab=dlq` → tab bar mostra 3 abas; aba "Pendências" ativa; conteúdo é o de DLQ.
- **A4** — Recepcionista (sem `alert.read`, sem `dlq.read`) acessa `/operacao/notificacoes` → tab bar mostra apenas "Notificações"; aba ativa = notificacoes.
- **A5** — Recepcionista acessa `/operacao/notificacoes?tab=alertas` → tab bar mostra apenas "Notificações"; aba ativa = notificacoes (fallback silencioso); HTML não contém nada de alertas.
- **A6** — Financeiro (`alert.read` = true, `dlq.read` = false) acessa `/operacao/notificacoes` → tab bar mostra 2 abas (Notificações, Alertas do sistema).
- **A7** — Click em `MarkAllButton` (aba notificacoes), `ResolveButton` (aba alertas) ou `ReprocessButton` (aba dlq) continua chamando os mesmos endpoints de API que hoje (FR-015 — funcionalidade preservada).

---

## Sininho (`NotificationBell`) — sem mudança necessária

`src/app/(dashboard)/_components/notification-bell.tsx` já linka para `/operacao/notificacoes` (verificado em `/speckit.plan`). Não precisa ser alterado para esta feature. FR-005 já é satisfeito pelo código atual.

---

## Status

Contract finalizado.
