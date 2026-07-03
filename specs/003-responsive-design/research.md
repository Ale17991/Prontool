# Phase 0 Research — Responsividade total

Esta feature é puramente de UI, então a "pesquisa" é alinhar **escolhas de
componentes**, **estratégias CSS**, e **abordagem de testes de regressão**.
Não há NEEDS CLARIFICATION na spec.

---

## Decisão 1: Drawer da sidebar mobile

**Decisão**: Usar **Sheet do shadcn/ui** (built on top of `@radix-ui/react-dialog` com `data-side` para slide-in lateral). Adicionar como `src/components/ui/sheet.tsx` via cópia do registry do shadcn.

**Rationale**:

- Já temos `@radix-ui/react-dialog` no bundle (Dialog component existente). Sheet é a mesma primitive em modo "side", custo de bundle é desprezível.
- Sheet do shadcn já oferece overlay semi-transparente, focus trap, fechamento por ESC e click-outside — atende FR-003, FR-004, FR-021 sem código custom.
- API consistente com Dialog que já usamos em vários modais (`<Sheet open={...} onOpenChange={...}>`).
- Animação slide-in/out vem dos `data-state=open|closed` do Radix + Tailwind animations já configurados no `tailwind.config`.

**Alternativas consideradas**:

- **framer-motion drawer custom**: já temos framer-motion, mas implementar focus trap, overlay e accessibility do zero seria reinventar o que Radix já dá pronto e bem testado. Rejeitado.
- **`<dialog>` HTML nativo**: ainda tem inconsistências em iOS Safari de versões anteriores; sem focus trap automático em todos os browsers; Tailwind animations não casam direto. Rejeitado.
- **Drawer permanente colapsável (compact + expanded com ícones)**: mais útil em telas médias (tablets), mas exige decisão extra "quando colapsa?". Para o escopo P1 (mobile), drawer off-canvas é mais simples e suficiente. Caso queiramos suporte mid-screen no futuro, é aditivo.

---

## Decisão 2: Breakpoint mobile/desktop

**Decisão**: **`md` do Tailwind (768px)** como cutoff. <768px = hamburger; ≥768px = sidebar permanente.

**Rationale**:

- Alinha com o breakpoint `md:` já usado por todos os forms e grids do projeto. Consistência reduz carga cognitiva.
- 768px é o portrait de iPad mini/Air — naturalmente o ponto onde sidebar fixa de 256px deixa de ser problema (256/768 = 33% da viewport, aceitável).
- Tailwind `md:` resolve por classe, sem precisar de hook React (`useMediaQuery`) — evita hidratação inconsistente entre SSR e cliente.

**Alternativas consideradas**:

- **`lg` (1024px)**: muito tarde — tablets em portrait passariam a hamburger. Rejeitado.
- **`sm` (640px)**: muito cedo — iPhone Pro Max (430-440px) fica em "sidebar fixa" o que é justamente o que queremos evitar. Rejeitado.
- **Custom breakpoint (700px ou 720px)**: divergiria dos breakpoints já usados no projeto. Rejeitado.

---

## Decisão 3: Hamburger + estado do drawer

**Decisão**: Botão hamburger no header (`<header>`), visível só em `<md` (`md:hidden`). Estado controlado em `<DashboardShell>` com `useState<boolean>(open)`. Sheet recebe `open` e `onOpenChange`.

**Rationale**:

- Estado local: o shell já é client component (`'use client'`), então useState não introduz overhead.
- Hamburger no header próximo ao logo segue convenção universal de mobile UI (Material, Apple HIG).
- Auto-fechar ao clicar em link de navegação dentro do Sheet (FR-005) é fácil: `onClick={() => setOpen(false)}` no link.

**Alternativas consideradas**:

- **Estado em URL (search param `?menu=open`)**: torna o estado bookmarkable e shareable, mas adiciona complexidade desnecessária. Rejeitado.
- **Context provider compartilhado**: overkill para um único trigger. Rejeitado.

---

## Decisão 4: Tab bar overflow-x

**Decisão**: Adicionar `overflow-x-auto scrollbar-hide` no container das tabs + `whitespace-nowrap` em cada `<CategoryTab>`. Scroll natural por gesture/wheel/drag. Auto-scroll da aba ativa via `ref + scrollIntoView({ inline: 'center' })` no mount.

**Rationale**:

- `overflow-x-auto` é a solução nativa CSS — navegação por touch já tem inércia em iOS sem código adicional.
- `scrollbar-hide` (plugin opcional) ou `[&::-webkit-scrollbar]:hidden` deixa a scrollbar invisível em desktop quando não há overflow real, sem barra feia em telas grandes.
- `scrollIntoView` é suportado em todos os browsers modernos; usar `inline: 'nearest'` evita scroll desnecessário quando a aba já está visível.

**Alternativas consideradas**:

- **Dropdown "Mais ▾" para abas overflow**: mais elegante mas exige medir largura runtime + state custom; complexidade alta para benefício marginal. Rejeitado.
- **Wrap (`flex-wrap`)**: tabs em múltiplas linhas em mobile estraga hierarquia visual e empurra conteúdo. Rejeitado.

---

## Decisão 5: Modal max-h + overflow

**Decisão**: Adicionar `max-h-[90dvh] overflow-y-auto` no `DialogContent` (`src/components/ui/dialog.tsx`). Padding `p-6` muda para `p-4 sm:p-6`.

**Rationale**:

- `dvh` (dynamic viewport height) é melhor que `vh` em mobile porque exclui a barra de URL e teclado virtual quando aberto. Suporte: iOS Safari 15.4+, Chrome 108+, Firefox 101+ — cobre 95%+ dos browsers ativos. Fallback automático para `vh` em browsers antigos via `max-h-[90vh]` se necessário (Tailwind tem ambos: `max-h-[90vh]` + arbitrary values com dvh).
- Mudança no componente base propaga para todos os ~5 modais existentes (Dialog do cleanup, print-chart, RecordPaymentDialog, etc.) sem tocar em cada caller — atende FR-010, FR-012, FR-013.
- `p-4 sm:p-6` ganha 16px de espaço útil em mobile sem afetar desktop.

**Alternativas consideradas**:

- **Modal fullscreen em mobile (sem max-h, ocupa 100% da tela)**: opção válida em apps mobile-only, mas para um app web responsivo a abordagem padrão é modal centralizado com scroll interno. Rejeitado por consistência com expectativa do usuário web.
- **`overscroll-behavior: contain`** sem `overflow-y-auto`: previne scroll do background mas não dá scroll interno. Insuficiente. Rejeitado.

---

## Decisão 6: Indicador de scroll horizontal em tabelas

**Decisão**: Wrapper `<div>` da `<Table>` ganha `position: relative` + dois pseudo-elementos via classes Tailwind (`before:` e `after:`) com `linear-gradient` + `pointer-events-none`. JS opcional para esconder os gradients quando scroll está no início/fim (via `onScroll` listener no wrapper).

**Rationale**:

- CSS-only com pseudo-elementos é suficiente para o caso "tem mais conteúdo nos lados" — atende FR-017 e SC-006.
- O componente `Table` em `components/ui/table.tsx` é compartilhado por todas as tabelas do projeto. Mudança lá propaga sem tocar em pages.
- JS para esconder/mostrar gradients dinamicamente é melhoria pontual: sem ele, gradient sempre aparece quando há scroll possível — visualmente aceitável.

**Alternativas consideradas**:

- **Sombra fixa nas bordas (sem scroll listener)**: sempre visível mesmo quando scroll está no final — distração visual mas funciona. Aceitável como v1.
- **Adicionar UI de "deslize" (texto/seta)**: poluído visualmente; gradient é mais sutil e universalmente entendido. Rejeitado.

---

## Decisão 7: Padding global do conteúdo

**Decisão**: No `<DashboardShell>`, mudar:

- `<header>`: `px-8` → `px-4 md:px-8`
- Tab bar wrapper: `px-8` → `px-4 md:px-8`
- Conteúdo principal: `p-8` → `p-4 md:p-8`

**Rationale**:

- 16px de padding em mobile (vs 32px) ganha 32px de área útil — significativo em viewport de 360px.
- Mudança em 1 arquivo (DashboardShell) cobre todas as pages do dashboard.
- Login (`(auth)/login/page.tsx`) já usa `p-6` próprio, sem mudança necessária.

**Alternativas consideradas**:

- **`p-2 md:p-8`**: muito apertado em mobile, conteúdo "encosta" nas bordas. Rejeitado.
- **`p-3 sm:p-4 md:p-8`**: fine-tuning excessivo sem benefício mensurável. Rejeitado.

---

## Decisão 8: Action bars que faltam wrap

**Decisão**: Identificar e ajustar pontualmente os action bars que não têm fallback responsivo. Achados no diagnóstico:

- `pacientes/[id]/page.tsx` header: `<div className="flex items-center justify-between gap-2">` → adicionar `flex-wrap` ou `flex-col sm:flex-row sm:items-center sm:justify-between`.

**Rationale**:

- A maioria dos action bars do projeto já tem `flex-col md:flex-row` (verificado em new-patient-form, address-editor, etc.). Só algumas instâncias pontuais precisam ajuste — não vale criar componente abstrato.
- Em telas estreitas (<640px), botões "Voltar / Imprimir / Limpar dados" ficam em coluna; em ≥640px, lado-a-lado.

**Alternativas consideradas**:

- **Componente `ActionBar` abstraído**: cria abstração para 1-2 callsites. Rejeitado por YAGNI.

---

## Decisão 9: Estratégia de testes de regressão visual

**Decisão**: Novo arquivo `tests/e2e/responsive-snapshots.spec.ts` com Playwright + `toHaveScreenshot()`:

- Capturar screenshots de 4 páginas-chave (login, lista de pacientes, ficha do paciente, dashboard financeira) em viewport `1280×720` ANTES das mudanças (commit baseline).
- Após mudanças, rodar mesmo teste — Playwright compara contra baseline e falha se houver diff perceptível.
- Adicionalmente, capturar em `375×812` (iPhone) e `768×1024` (iPad portrait) para documentar o novo comportamento mobile/tablet (snapshot inicial = baseline para futuras regressões).

**Rationale**:

- `toHaveScreenshot` é built-in do Playwright, sem deps extras.
- Threshold default (10% diff por pixel) é razoável — captura mudanças significativas mas tolera anti-aliasing.
- 1280×720 cobre a meta de SC-004 ("zero diffs em viewports ≥1024px").
- Snapshots mobile/tablet servem como "novo baseline" — não comparam com desktop, garantem que mudanças futuras não quebrem o layout responsivo conquistado agora.

**Alternativas consideradas**:

- **Percy / Chromatic / serviço SaaS**: melhor UX para revisão visual, mas requer credencial + custo. Para um time pequeno, snapshots locais bastam. Rejeitado para v1.
- **Visual regression apenas via `npm run build` em CI**: não captura layout problems, só erros de TypeScript. Insuficiente. Rejeitado.

---

## Decisão 10: Foco e acessibilidade do drawer

**Decisão**: Sheet do shadcn já entrega focus trap (via Radix Dialog) e aria-modal por default. Adicionar `aria-label="Abrir menu"` no botão hamburger (visible-only-to-AT — sem texto visível) e `<SheetTitle>Navegação</SheetTitle>` dentro do Sheet (visualmente escondido com `sr-only`).

**Rationale**:

- Atende FR-020 e FR-021 sem código custom.
- Radix garante que `Esc` fecha, foco volta para o trigger ao fechar — comportamento padrão.

**Alternativas consideradas**:

- **Tab focus manual com `onKeyDown`**: reinventa o que Radix faz. Rejeitado.

---

## Resumo das decisões

| #   | Decisão                                   | Arquivo afetado                                 |
| --- | ----------------------------------------- | ----------------------------------------------- |
| 1   | Sheet do shadcn para drawer               | `src/components/ui/sheet.tsx` (novo)            |
| 2   | Breakpoint `md` (768px)                   | (config — Tailwind padrão)                      |
| 3   | Estado local + hamburger no header        | `dashboard-shell.tsx`                           |
| 4   | Tab bar com overflow-x-auto + auto-scroll | `dashboard-shell.tsx`                           |
| 5   | Dialog com max-h-[90dvh] + p responsive   | `src/components/ui/dialog.tsx`                  |
| 6   | Tabela com fade gradients nas bordas      | `src/components/ui/table.tsx`                   |
| 7   | Padding `p-4 md:p-8` no shell             | `dashboard-shell.tsx`                           |
| 8   | Action bar do paciente com flex-wrap      | `operacao/pacientes/[id]/page.tsx`              |
| 9   | Playwright snapshots @1280×720            | `tests/e2e/responsive-snapshots.spec.ts` (novo) |
| 10  | a11y via Radix defaults + aria-label      | `dashboard-shell.tsx`                           |

**Sem NEEDS CLARIFICATION pendentes.** Pronto para Phase 1.
