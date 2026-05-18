# Phase 0 — Research

**Feature**: Sidebar enxuta + Configurações como hub
**Branch**: `014-sidebar-config-hub`
**Date**: 2026-05-18

A spec saiu com **zero** `[NEEDS CLARIFICATION]` (todas resolvidas em `/speckit.specify`). Esta fase consolida as **decisões técnicas** que sustentam o plan, com rationale e alternativas avaliadas.

---

## R1 — Sistema de tabs em `/operacao/notificacoes`

**Decision**: Tabs **server-rendered** via `searchParams.tab` (?tab=notificacoes|alertas|dlq). A página é um Server Component que decide qual sub-seção renderizar com base em (a) `searchParams.tab` e (b) permissões da sessão (`alert.read`, `dlq.read`). A "barra de tabs" no topo é um pequeno `<nav>` com `Link` do Next, navegando entre as três URLs.

**Rationale**:
- O Next.js 14 App Router renderiza Server Components de novo a cada mudança de query string — não precisa de client state.
- Mantém SSR puro (sem hidratação extra), consistente com o resto do dashboard (FR-017).
- A página unificada já decide RBAC no servidor; renderizar a tab via URL é a forma mais simples de garantir que sub-seções proibidas nunca chegam ao DOM (Constituição V).
- O redirect das rotas legadas (`/operacao/alertas` → `?tab=alertas`; `/operacao/dlq` → `?tab=dlq`) compõe naturalmente — mesma porta de entrada.

**Alternativas avaliadas**:
- **Radix Tabs do shadcn (client-side)** — adiciona "use client", JS extra e dependência de estado local. Não justificável dado o requisito de SSR e a simplicidade do conteúdo (3 abas, sem fetch ao trocar).
- **Acordion vertical** — descartado: pior densidade visual com 3 seções; navegação por bookmark direta a uma seção fica ambígua.
- **Páginas separadas + sidebar com links** — é o que existe hoje e estamos justamente removendo.

---

## R2 — Grid responsivo do hub `/configuracoes`

**Decision**: Tailwind `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4` no container do hub. Cada card é um `<Link>` que envolve `<Card>` (shadcn/ui já em uso) com layout: ícone à esquerda em coluna, título + descrição empilhados à direita; padding consistente; hover state com leve elevação/ring.

**Rationale**:
- 1/2/3 colunas confirmados na spec (decisão Q3 com default adotado).
- `gap-4` (16px) é o espaçamento padrão em outros grids do dashboard.
- Envolver o card inteiro num `<Link>` (em vez de só o título) maximiza a área de clique — UX padrão para grids navegacionais.
- Reaproveita `Card`/`CardHeader`/`CardContent` do shadcn — zero CSS custom.

**Alternativas avaliadas**:
- **Container queries** — overkill para 9 cards; breakpoints viewport já suficientes.
- **Masonry / grid auto-fill** — pode produzir colunas órfãs; 3 colunas fixas em lg+ é mais previsível.
- **Lista vertical em mobile com avatars maiores** — mais espaço, menos densidade; preferimos manter o padrão do dashboard (cards sempre, viewport ajusta colunas).

---

## R3 — Mecanismo de redirect das rotas legadas

**Decision**: `redirect()` de `next/navigation` dentro de Server Components nas páginas legadas (`/analise/auditoria/page.tsx`, `/operacao/alertas/page.tsx`, `/operacao/dlq/page.tsx`). Cada uma vira uma página com **uma linha** de lógica que repassa `searchParams` para o destino. Next.js converte isso em redirect HTTP **307** por padrão; para sinalizar "esta URL mudou permanentemente" prevenindo cache stale em search engines / clients, usar `permanentRedirect()` (HTTP **308**) — disponível em Next.js 14 desde a versão 14.0.

**Rationale**:
- Páginas servidas por App Router permitem `redirect()`/`permanentRedirect()` direto no `default export async function` — sem precisar mexer em `middleware.ts`, sem regex em `next.config.js`.
- `permanentRedirect()` (308) preserva o método HTTP e sinaliza cache permanente — comportamento correto para "URL movida para sempre" (Auditoria) e "rota desativada permanentemente" (alertas/dlq como página standalone).
- `searchParams` é repassada construindo a URL de destino com `URLSearchParams` (preserva filtros que o usuário tinha).
- A permissão é validada **no destino** (página de notificações ou de auditoria), não na página de redirect — o redirect é "puro mapeamento de URL", o RBAC continua na página de chegada.

**Alternativas avaliadas**:
- **`next.config.js` `redirects()`** — global, estático; funciona mas vive longe das páginas e dificulta passar query strings condicionalmente. Para 3 rotas que ficam adjacentes ao código de destino, manter o redirect no `page.tsx` é mais coeso.
- **`middleware.ts`** — exagero para 3 redirects estáticos; middleware roda em toda request e mistura concerns.
- **307 sem `permanentRedirect`** — funciona, mas semanticamente o servidor estaria dizendo "talvez essa rota volte"; queremos sinalizar movimento permanente.

---

## R4 — Estrutura do hub de cards (server-render + RBAC)

**Decision**: O array de cards fica num módulo separado **server-only** (ex.: `src/app/(dashboard)/configuracoes/_cards.ts`) exportando uma constante `HUB_CARDS: readonly HubCardDef[]`. A page `/configuracoes/page.tsx` lê a sessão via `getSession()`, lê feature flags, filtra `HUB_CARDS` pelo predicado de cada um, e renderiza o grid. **A ordem é fixada no array** (mesma ordem do FR-009: Clínica, Meu Perfil, Usuários, Procedimentos, Convênios, Profissionais, Modelos de Anamnese, Integrações, Auditoria — Auditoria sempre por último).

**Rationale**:
- Espelha o padrão existente em `dashboard-shell.tsx` (array `SECTIONS` com predicado `show`), evitando inventar uma nova arquitetura.
- Server-render garante FR-017 (sem flash de cards proibidos).
- Constante separada facilita escrever testes que verificam ordem, visibilidade por role, e cobertura (todos os 9 destinos têm card).
- "Server-only" porque importa `getSession` indireto e não há razão para vazar a tabela inteira ao client.

**Alternativas avaliadas**:
- **Construir cards inline no `page.tsx`** — viola separação de dados e visualização; testes ficam acoplados ao JSX.
- **Carregar de banco** — overkill; cards são metadata estática conhecida em build.
- **Permitir reordenação pelo usuário** — fora de escopo (não pedido).

---

## R5 — Onde mora o código de auditoria após a movimentação?

**Decision**: O conteúdo de `src/app/(dashboard)/analise/auditoria/page.tsx` é **fisicamente movido** (git `mv` ou cópia + apagar original) para `src/app/(dashboard)/configuracoes/auditoria/page.tsx`. A página antiga (`/analise/auditoria/page.tsx`) é reescrita como redirect 308 conforme R3. Qualquer componente filho específico da auditoria (botões, filtros) que viva no mesmo diretório também é movido junto.

**Rationale**:
- FR-013 + decisão Q2/A pedem `/configuracoes/auditoria` como rota canônica.
- Mover fisicamente (vs. apenas reapontar) elimina "casa fantasma" — futuro código de auditoria evolui no diretório certo, junto das outras configurações administrativas.
- `git mv` preserva history (importante para auditoria do próprio código de auditoria — meta, mas relevante).

**Alternativas avaliadas**:
- **Manter código em `/analise/` e fazer `/configuracoes/auditoria` ser um re-export** — adiciona indireção; testes precisam saber de duas casas; pior manutenção.
- **Mover e remover redirect** — quebra bookmarks; viola FR-007/FR-015 (compatibilidade).

---

## R6 — Sidebar enxugada: estratégia de mudança em `dashboard-shell.tsx`

**Decision**: Substituir o array `SECTIONS` por uma versão mais curta. Manter o tipo `NavSection.id` como `'operacao' | 'analise' | 'configuracoes'` mas reduzir o conteúdo da seção `configuracoes` para **um único item** ("Configurações" apontando para `/configuracoes`, com predicado `() => true` — sempre visível para autenticado, ver FR-004). Adicionar um separador visual antes da seção `configuracoes` (border-t + spacing) no componente `SidebarInner`. Remover de `operacao` os itens "Notificações", "Alertas do sistema", "Pendências". Remover de `analise` o item "Auditoria".

**Rationale**:
- Reaproveita 100% da infraestrutura de RBAC + feature flag existente.
- Mudança fica localizada num arquivo (`dashboard-shell.tsx`) — fácil reverter via git se preciso.
- Manter a estrutura de 3 seções (operacao/analise/configuracoes) mantém estilos de heading consistentes.
- O separador visual entre "Análise" e "Configurações" é um `<div className="border-t border-white/5 my-2" />` ou similar — alternativa: tratar `configuracoes` como uma seção sem label e com classe extra de margem-top.

**Alternativas avaliadas**:
- **Botão "Configurações" fora da `<nav>`** (junto ao avatar no rodapé) — quebra alinhamento visual e expectativa de usuário; menus de admin normalmente moram junto da navegação.
- **Reescrever o componente do zero** — irreal para a escala da mudança; risco alto sem ganho.

---

## R7 — Estratégia de testes

**Decision**:
1. **Unit (vitest)** — testar `dashboard-shell` (helper `SECTIONS` extraído como módulo testável) e o módulo `HUB_CARDS`. Matriz: cada role (admin, financeiro, recepcionista, profissional_saude) × cada flag combo → conjunto esperado de itens/cards visíveis.
2. **Integration (vitest + supertest-like / Next test utilities se já em uso)** — hitting nas rotas legadas e verificando 308 + Location header. Verificar que `/operacao/notificacoes?tab=alertas` renderiza sub-seção apenas para quem tem `alert.read`.
3. **Manual / quickstart** — checklist humano com login em cada role, screenshots da sidebar e do hub.

**Rationale**:
- O projeto já usa Vitest 1.6 — sem nova ferramenta.
- Testes de matriz role × visibilidade são onde bugs de RBAC normalmente aparecem; matriz explícita evita regressão silenciosa.
- Testes de redirect podem ser feitos por hit direto na page Server Component (renderizar e checar throw de `redirect()`/`permanentRedirect()`).

**Alternativas avaliadas**:
- **Playwright E2E** — não há evidência de Playwright no projeto; adicionar só para essa feature é overkill.
- **Snapshot testing do JSX completo** — frágil; testes focados em "presença/ausência por role" são mais úteis.

---

## R8 — Acessibilidade do hub e das tabs

**Decision**:
- **Hub**: cada card é um `<Link>` envolvendo um bloco semântico com `<h2>` (título) + `<p>` (descrição). `aria-label` no link replicando o título para clarity em screen readers. Ícone tem `aria-hidden="true"` (decorativo, info já está no título).
- **Tabs em /operacao/notificacoes**: usa `role="tablist"`/`role="tab"`/`role="tabpanel"` se for client; como decidimos server-render (R1), a estrutura é apenas `<nav aria-label="Seções da página">` com `<Link>` para cada tab e `aria-current="page"` na ativa.

**Rationale**:
- Server-rendered tabs com `Link` + `aria-current` é mais simples e compatível com SR padrão; não há estado client a sincronizar.
- `aria-hidden` em ícones decorativos evita ruído em leitores de tela.

**Alternativas avaliadas**:
- **Radix Tabs com roles ARIA completos** — exigiria client component; trade-off contra simplicidade SSR de R1. Considerado e descartado.

---

## Resumo das decisões

| ID | Decisão | Onde se materializa |
|----|---------|---------------------|
| R1 | Tabs server-rendered via `?tab=...` | `/operacao/notificacoes/page.tsx` |
| R2 | Grid 1/2/3 colunas com `Card` shadcn | `/configuracoes/page.tsx` |
| R3 | `permanentRedirect()` (308) nas páginas legadas | `/analise/auditoria/page.tsx`, `/operacao/alertas/page.tsx`, `/operacao/dlq/page.tsx` |
| R4 | `HUB_CARDS` em módulo server-only | `src/app/(dashboard)/configuracoes/_cards.ts` |
| R5 | Mover código de auditoria fisicamente | `git mv` → `/configuracoes/auditoria/` |
| R6 | Mudança localizada em `dashboard-shell.tsx` | `src/app/(dashboard)/_components/dashboard-shell.tsx` |
| R7 | Vitest unit + integration; quickstart manual | `tests/` |
| R8 | `<Link>` + `aria-current` para tabs; `aria-hidden` em ícones decorativos | hub + tabs |

**Status**: Phase 0 completa. Zero `NEEDS CLARIFICATION` pendentes. Pronto para Phase 1.
