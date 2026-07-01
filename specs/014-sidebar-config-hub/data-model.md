# Phase 1 — Data Model

**Feature**: Sidebar enxuta + Configurações como hub
**Branch**: `014-sidebar-config-hub`
**Date**: 2026-05-18

## Sumário

Esta feature é **puramente UI**. Conforme FR-016, nenhuma migration, RLS, função SQL, bucket ou tabela é tocada. Portanto, **não há entidades de domínio** novas, alteradas ou removidas no banco de dados.

O que existe aqui é o **schema de configuração de UI** que define como a sidebar e o hub renderizam itens/cards. Esses tipos vivem no código TypeScript (não no banco) e existem para tornar a configuração testável e dar contrato explícito ao plano de implementação.

---

## Tipos de UI (TypeScript, in-memory only)

### `NavItem` (já existe — reaproveitado, não alterado em forma)

Reaproveitado de `dashboard-shell.tsx`. **Sem mudança de tipo** — apenas o conteúdo do array `SECTIONS` muda.

```ts
interface NavItem {
  href: Route // typed route do Next.js
  label: string // texto exibido na sidebar
  icon: LucideIcon // ícone (lucide-react)
  show: (ctx: NavContext) => boolean // predicado RBAC + flags
}

interface NavSection {
  id: 'operacao' | 'analise' | 'configuracoes'
  label: string
  items: NavItem[]
}

interface NavContext {
  role: TenantRole // 'admin' | 'financeiro' | ...
  flags: Record<FeatureName, boolean> // listFeatureFlags()
}
```

**Conteúdo do array `SECTIONS` após esta feature** (alteração de dados, não de schema):

| Section       | Item label    | Predicado `show`                               |
| ------------- | ------------- | ---------------------------------------------- |
| operacao      | Agenda        | `can(role, 'appointment.read')`                |
| operacao      | Pacientes     | `can(role, 'appointment.read')`                |
| operacao      | Tarefas       | `can(role, 'task.read')`                       |
| analise       | Relatórios    | `flags.relatorios && can(role, 'report.read')` |
| analise       | Comissões     | `flags.comissoes && can(role, 'doctor.read')`  |
| analise       | Despesas      | `flags.despesas && role === 'admin'`           |
| configuracoes | Configurações | `() => true`                                   |

Itens **removidos** da estrutura atual:

- operacao → Notificações, Alertas do sistema, Pendências
- analise → Auditoria
- configuracoes → Clínica, Meu Perfil, Usuários, Procedimentos, Convênios, Profissionais, Modelos de Anamnese, Integrações (todos absorvidos pelo hub)

---

### `HubCardDef` (NOVO — server-only, in-memory only)

Define um card do hub `/configuracoes`. Vive em `src/app/(dashboard)/configuracoes/_cards.ts` (server-only). **Não é persistido**.

```ts
import type { LucideIcon } from 'lucide-react'
import type { Route } from 'next'
import type { TenantRole } from '@/lib/db/types'
import type { FeatureName } from '@/lib/feature-flags'

interface HubCardCtx {
  role: TenantRole
  flags: Record<FeatureName, boolean>
}

interface HubCardDef {
  /** Identificador estável (usado em testes). */
  id:
    | 'clinica'
    | 'perfil'
    | 'usuarios'
    | 'procedimentos'
    | 'convenios'
    | 'profissionais'
    | 'modelos-anamnese'
    | 'integracoes'
    | 'auditoria'
  /** Rota de destino — tipada via `Route<typed>` do Next. */
  href: Route
  /** Título exibido no card (≤ 30 chars). */
  title: string
  /** Descrição de uma linha (≤ 80 chars). */
  description: string
  /** Ícone lucide. */
  icon: LucideIcon
  /** Predicado de visibilidade — espelha o `show` da sidebar antiga. */
  show: (ctx: HubCardCtx) => boolean
}
```

**Conteúdo de `HUB_CARDS` (ordem fixa — FR-009):**

| #   | id               | title               | description (1 linha)                             | href                            | show                                 |
| --- | ---------------- | ------------------- | ------------------------------------------------- | ------------------------------- | ------------------------------------ |
| 1   | clinica          | Clínica             | Dados, logo e identidade visual da clínica        | /configuracoes/clinica          | `role === 'admin'`                   |
| 2   | perfil           | Meu Perfil          | Seus dados pessoais, avatar e preferências        | /configuracoes/perfil           | `() => true`                         |
| 3   | usuarios         | Usuários            | Convide e gerencie quem tem acesso à clínica      | /configuracoes/usuarios         | `role === 'admin'`                   |
| 4   | procedimentos    | Procedimentos       | Catálogo de procedimentos e códigos TUSS          | /configuracoes/procedimentos    | `can(role, 'procedure.read')`        |
| 5   | convenios        | Convênios           | Convênios atendidos e tabelas de preço            | /configuracoes/convenios        | `can(role, 'plan.read')`             |
| 6   | profissionais    | Profissionais       | Profissionais de saúde e comissões                | /configuracoes/profissionais    | `can(role, 'doctor.read')`           |
| 7   | modelos-anamnese | Modelos de Anamnese | Modelos clínicos reutilizáveis nos atendimentos   | /configuracoes/modelos-anamnese | `flags.anamnese && role === 'admin'` |
| 8   | integracoes      | Integrações         | Conexões com WhatsApp, GHL e outros sistemas      | /configuracoes/integracoes      | `role === 'admin'`                   |
| 9   | auditoria        | Auditoria           | Trilha completa de alterações e acessos sensíveis | /configuracoes/auditoria        | `can(role, 'audit.read')`            |

**Invariantes** (testáveis):

- INV-1: `HUB_CARDS.length === 9` (nem 8, nem 10 — a feature define exatamente esses 9 destinos).
- INV-2: `HUB_CARDS[8].id === 'auditoria'` (Auditoria sempre no último índice — FR-009).
- INV-3: Cada `card.show({ role: 'admin', flags: <todas true> })` retorna `true` para os 9 cards.
- INV-4: Cada `card.show({ role: 'profissional_saude', flags: <todas false> })` retorna `true` apenas para `id === 'perfil'`.
- INV-5: `card.id` é único em todo o array.

---

### `NotificationsTab` (NOVO — UI helper, in-memory only)

Define as abas server-rendered da página `/operacao/notificacoes`. Vive como tipo interno na página ou em um helper adjacente.

```ts
interface NotificationsTabDef {
  id: 'notificacoes' | 'alertas' | 'dlq'
  label: string // 'Notificações' | 'Alertas do sistema' | 'Pendências'
  href: Route // /operacao/notificacoes?tab=...
  requires: Permission | null // null = sempre visível para autenticado
}
```

**Conteúdo:**

| tab id       | label              | requires                                 |
| ------------ | ------------------ | ---------------------------------------- |
| notificacoes | Notificações       | `null` (sempre visível — é a aba padrão) |
| alertas      | Alertas do sistema | `alert.read`                             |
| dlq          | Pendências         | `dlq.read`                               |

**Comportamento**:

- Filtra a lista pelas permissões do usuário **no servidor** antes de renderizar a tab bar.
- `searchParams.tab` resolve a aba ativa; se não vier, default = `notificacoes`.
- Se vier `?tab=alertas` mas o usuário não tem `alert.read`, **cai silenciosamente** para `notificacoes` (edge case já especificado).

---

## Banco de dados

**Não há mudança.** Esta feature não toca:

- Migrations (`supabase/migrations/`)
- Tabelas (`appointments`, `notifications`, `alerts`, `audit_log`, etc.)
- RLS policies
- Funções SQL / RPCs
- Buckets de Storage

Listagem dos dados que cada página exibe (sem mudanças — só repetindo o que já existe):

| Página                                      | Tabela fonte                             | Cliente Supabase | Filtro                  |
| ------------------------------------------- | ---------------------------------------- | ---------------- | ----------------------- |
| `/operacao/notificacoes` (aba notificações) | `notifications`                          | server           | `tenant_id` + `user_id` |
| `/operacao/notificacoes` (aba alertas)      | `alerts`                                 | server           | `tenant_id`             |
| `/operacao/notificacoes` (aba pendências)   | (mesmas queries de `/operacao/dlq` hoje) | server           | `tenant_id`             |
| `/configuracoes/auditoria`                  | `audit_log`                              | server           | `tenant_id`             |

Todas continuam aplicando RLS por `tenant_id` via `getSession()` + clientes Supabase já existentes (Constituição III).

---

## Estados / Transições

Não aplicável. Esta feature não introduz máquinas de estado nem fluxos com mudança de status. As tabs alteram apenas qual sub-seção é renderizada — não há "estado" no sentido de domínio.

---

## Status

Phase 1 (data-model): **completa**. Nenhuma decisão pendente; nenhuma migration a planejar; o "modelo de dados" desta feature é puramente o array `HUB_CARDS` e a configuração de abas em memória.
