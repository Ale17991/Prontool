# Data Model — 016 Designer Palette Rollout

> **Nota**: esta feature é UI/CSS pura — não há entidades de banco. Este documento descreve as **entidades-conceito do design system** (tokens, escala tipográfica, status visuais) tratadas como modelo, para servir de referência canônica nas tarefas de implementação e para futuros features que consumirem o sistema.

---

## 1. Token Cromático

Representa uma cor nomeada com função semântica, exposta como variável CSS no escopo `:root`.

**Campos**:

- `name` — string kebab-case, prefixada por `--`. Ex.: `--success`.
- `category` — `core` | `semantic` | `sidebar` | `typography`.
- `format` — `hsl-triple` (`"H S% L%"` para uso em `hsl(var(--token))`) **ou** `rgba` (cor completa para uso direto) **ou** `hex` (idem).
- `value` — string crua armazenada.
- `consumed_by` — lista de classes Tailwind ou componentes que dependem do token.
- `foreground_token` (opcional) — nome do token que deve ser usado como texto sobre este.

**Estados**: cada token é binário (presente / ausente). Não há transições. Atualizações são edições diretas no arquivo `globals.css`.

**Regras de validação** (verificáveis no plano):

- `name` MUST ser único.
- Pares `*` + `*-foreground` definidos juntos.
- Para tokens com `format: hsl-triple`: o par MUST ter contraste ≥ WCAG AA (4.5:1 texto / 3:1 UI).
- Tokens `core` (`--primary`, `--background`, `--foreground`, `--border`, `--ring`) NÃO podem ser removidos — quebrariam shadcn.

**Lista canônica final**:

```text
Categoria CORE (existentes, manter)
  --background           hsl-triple   210 40% 98%
  --foreground           hsl-triple   222 47% 11%
  --card                 hsl-triple   0 0% 100%
  --card-foreground      hsl-triple   222 47% 11%
  --popover              hsl-triple   0 0% 100%
  --popover-foreground   hsl-triple   222 47% 11%
  --primary              hsl-triple   217 91% 60%       [Blue 600 — MANTIDO]
  --primary-foreground   hsl-triple   210 40% 98%
  --secondary            hsl-triple   210 40% 96%
  --secondary-foreground hsl-triple   222 47% 11%
  --muted                hsl-triple   210 40% 96%
  --muted-foreground     hsl-triple   215 16% 47%
  --destructive          hsl-triple   0 72% 51%
  --destructive-foreground hsl-triple 210 40% 98%
  --border               hsl-triple   214 32% 91%
  --input                hsl-triple   214 32% 91%
  --ring                 hsl-triple   217 91% 60%
  --radius               other        0.625rem

Categoria CORE (atualizados)
  --accent               hsl-triple   180 22% 84%       [foi slate-100; vira #CBE1E1 verde suave do designer]
  --accent-foreground    hsl-triple   182 86% 16%       [#05494B do designer]

Categoria SEMANTIC (novos)
  --success              hsl-triple   182 72% 40%       [#1CABB0 do designer]
  --success-foreground   hsl-triple   0 0% 100%
  --success-bg           hsl-triple   180 22% 84%       [#CBE1E1 do designer]
  --success-text         hsl-triple   182 86% 16%       [#05494B do designer]

  --warning              hsl-triple   38 92% 50%        [amber-500]
  --warning-foreground   hsl-triple   26 83% 14%        [amber-950]

  --info                 hsl-triple   204 49% 56%       [#569AC6 do designer]
  --info-foreground      hsl-triple   0 0% 100%
  --info-bg              hsl-triple   204 80% 88%       [#CBE6F8 do designer]
  --info-text            hsl-triple   205 73% 21%       [#0E3C5B do designer]

  --alert                hsl-triple   0 84% 60%         [red-600 — distinto de --destructive]
  --alert-foreground     hsl-triple   0 0% 100%

Categoria SIDEBAR (novos — alpha intrínseca, NÃO HSL)
  --sidebar-bg               hex      #0E3C5B
  --sidebar-text             rgba     rgba(255,255,255,0.75)
  --sidebar-active-bg        rgba     rgba(86,154,198,0.2)
  --sidebar-active-text      hex      #CBE6F8           [clarified em 2026-05-18 — não é #93C5FD]
  --sidebar-switch           hex      #569AC6
  --sidebar-hover            rgba     rgba(255,255,255,0.05)
  --sidebar-section-label    rgba     rgba(255,255,255,0.4)
  --sidebar-separator        rgba     rgba(255,255,255,0.1)
```

Total: **17 core + 12 semantic + 8 sidebar = 37 tokens** (sendo 21 novos/atualizados).

---

## 2. Escala Tipográfica

Representa um nível tipográfico nomeado, aplicado como classe utilitária CSS.

**Campos**:

- `name` — string kebab-case, prefixada por `text-`. Ex.: `text-body`.
- `font_size_px` — número (px). MUST ser ≥ 12 (exceção registrada: `text-caption` pode descer a 11 em rótulos de métrica).
- `font_weight` — número (100–900).
- `line_height` — número (multiplicador, ex.: 1.6).
- `font_family` — `sans` | `mono`.

**Lista canônica**:

```text
.text-display    font-size:28px  weight:500  leading:1.3   family:sans
.text-h1         font-size:22px  weight:500  leading:1.4   family:sans
.text-h2         font-size:18px  weight:500  leading:1.5   family:sans
.text-h3         font-size:16px  weight:500  leading:1.5   family:sans
.text-body       font-size:14px  weight:400  leading:1.6   family:sans
.text-caption    font-size:12px  weight:400  leading:1.5   family:sans
.text-mono       font-size:13px  weight:400  leading:1.4   family:mono
```

**Regras de validação**:

- `font_size_px` ≥ 12 para qualquer texto da UI principal.
- `text-caption` pode ter rótulos de métrica em 11px **localmente** (com classe explícita; não via override de `.text-caption`).
- `family: mono` aplica a stack mono herdada do Tailwind (`ui-monospace`).

**Transição**: nenhuma — classes são estáticas. Atualizações exigem edição em `globals.css`.

---

## 3. Status Visual de Atendimento

Representa um estado conceitual do ciclo de vida de uma consulta, mapeado a uma representação visual unificada.

**Campos**:

- `variant` — chave string. Valores possíveis: `agendado`, `confirmado`, `concluido`, `em_atendimento`, `no_show`, `cancelado`, `estornado`.
- `label_pt` — texto em português exibido ao usuário.
- `icon` — nome do ícone Lucide.
- `bg_token` — token CSS de fundo (ex.: `--info-bg`).
- `text_token` — token CSS de texto (ex.: `--info-text`).
- `pattern` — `solid` | `dashed` | `striped` | `opacity-60`. Padrão visual além da cor.
- `motion` — `none` | `pulse-safe`. `pulse-safe` significa `motion-safe:animate-pulse` (estático em `prefers-reduced-motion: reduce`).

**Lista canônica (7 variantes)**:

```text
variant         label_pt          icon         bg_token       text_token      pattern       motion
agendado        Agendado          Calendar     --info-bg      --info-text     solid         none
confirmado      Confirmado        Check        --success-bg   --success-text  solid         none
concluido       Concluído         CheckCheck   --success-bg   --success-text  opacity-60    none
em_atendimento  Em atendimento    Clock        --warning      --warning-fg    solid         pulse-safe
no_show         Não compareceu    UserX        --muted        --muted-fg     striped       none
cancelado       Cancelado         X            --muted        --muted-fg     dashed        none
estornado       Estornado         RotateCcw    --alert        --alert-fg     solid         none
```

> **Nota de domínio**: o banco hoje (migration 0054) só tem `agendado` | `ativo` | `estornado`. Mapper inicial (definido em `research.md` §3):
>
> - `agendado` → `agendado`
> - `ativo` → `concluido` (escolha pragmática até domínio receber estados intermediários)
> - `estornado` → `estornado`
>
> Os outros 4 (`confirmado`, `em_atendimento`, `no_show`, `cancelado`) ficam disponíveis no componente para evolução futura.

**Regras de validação**:

- `variant` MUST ser único.
- `label_pt` MUST estar em português, capitalizado.
- `icon` MUST existir em `node_modules/lucide-react`.
- Pares `bg_token` + `text_token` MUST atender WCAG AA (pré-validado em `research.md` §10).
- `pattern: striped` MUST manter legibilidade do label adjacente.
- `motion: pulse-safe` MUST exibir indicador estático equivalente quando reduced-motion ativo.

**Transições**: estado é determinado pelo domínio (campo `effectiveStatus` do appointment); este componente não muda estado, apenas renderiza.

---

## 4. Identidade Tipográfica

Representa a configuração da fonte primária do produto.

**Campos**:

- `family_name` — `Inter`.
- `loading_strategy` — `next-font-google-swap` | `cdn-link` | `system-fallback`.
- `subsets` — lista de subsets carregados.
- `css_variable` — `--font-sans`.
- `opentype_features` — lista de features ativas. Atual: `cv11`, `ss01`.

**Estado-alvo**:

```text
family_name: Inter
loading_strategy: next-font-google-swap
subsets: [latin]
css_variable: --font-sans
opentype_features: [cv11, ss01]
```

**Transição**: `cdn-link` (estado atual) → `next-font-google-swap` (estado-alvo). Reversível, mas a migração elimina dependência de domínio externo em runtime.

---

## 5. Identidade Visual da Sidebar

Representa a composição de tokens aplicados ao componente `dashboard-shell.tsx`.

**Campos** (todos consomem tokens definidos em §1, categoria SIDEBAR):

- `background` → `--sidebar-bg`
- `text_color` → `--sidebar-text`
- `active_item_background` → `--sidebar-active-bg`
- `active_item_text` → `--sidebar-active-text`
- `tenant_switch_link_color` → `--sidebar-switch`
- `hover_background` → `--sidebar-hover`
- `section_label_color` → `--sidebar-section-label`
- `separator_color` → `--sidebar-separator`

**Diferenças vs. estado atual** (consolidadas em `research.md` §8): 7 substituições + 1 valor numérico alterado (separator: 0.05 → 0.1).

---

## Resumo

| Entidade-conceito            | Quantidade                | Localização canônica                                    |
| ---------------------------- | ------------------------- | ------------------------------------------------------- |
| Token Cromático              | 37 (21 novos/atualizados) | `src/app/globals.css`                                   |
| Escala Tipográfica           | 7 níveis                  | `src/app/globals.css` (classes utilitárias)             |
| Status Visual de Atendimento | 7 variantes               | `src/components/ui/appointment-status-badge.tsx` (novo) |
| Identidade Tipográfica       | 1 configuração            | `src/app/layout.tsx` + `globals.css`                    |
| Identidade Visual da Sidebar | 8 propriedades            | `src/app/(dashboard)/_components/dashboard-shell.tsx`   |
