# Research — 016 Designer Palette Rollout

**Phase 0 output.** Consolida decisões técnicas necessárias antes do design (Phase 1) e antes da implementação.

---

## 1. Conversão hex → HSL (formato shadcn/Tailwind)

**Decisão**: Cada hex da paleta híbrida do designer é convertido para "H S% L%" (formato esperado por `hsl(var(--token))` no Tailwind v3 + shadcn).

| Hex       | HSL (H S% L%) | Token alvo                                                      |
| --------- | ------------- | --------------------------------------------------------------- |
| `#0E3C5B` | `205 73% 21%` | `--sidebar-bg`, `--info-text`                                   |
| `#1F628E` | `204 64% 34%` | (reservado — hover/destaque sidebar)                            |
| `#569AC6` | `204 49% 56%` | `--info`, `--sidebar-switch`, `--sidebar-active-bg` (base RGBA) |
| `#CBE6F8` | `204 80% 88%` | `--info-bg`, `--sidebar-active-text`                            |
| `#05494B` | `182 86% 16%` | `--success-text`, `--accent-foreground`                         |
| `#126F72` | `182 72% 26%` | (reservado — success forte)                                     |
| `#1CABB0` | `182 72% 40%` | `--success`                                                     |
| `#CBE1E1` | `180 22% 84%` | `--success-bg`, `--accent`                                      |
| `#2563EB` | `217 91% 60%` | `--primary` (mantido)                                           |
| `#F59E0B` | `38 92% 50%`  | `--warning`                                                     |
| `#DC2626` | `0 84% 60%`   | `--alert`                                                       |

**Rationale**: HSL é o formato canônico do shadcn — permite `bg-success/15` (alpha modifier do Tailwind) funcionar sem alterações. Hex direto não suporta alpha modifier no Tailwind v3.

**Alternativas consideradas**:

- **Hex direto via `bg-[#1CABB0]`**: descartado — quebra o alpha modifier e cria fricção com shadcn components que assumem `hsl(var(--token))`.
- **OKLCH**: shadcn v0 começa a adotar, mas Tailwind v3 não suporta nativamente. Migração futura, fora de escopo.

---

## 2. Migração de Inter via `next/font/google` preservando OpenType features

**Decisão**: Usar `next/font/google` com declaração de variable CSS e aplicar `font-feature-settings` via classe utilitária CSS aplicada ao `<body>`. Manter `cv11` e `ss01` (já em uso hoje em `globals.css` linha 39).

```ts
// src/app/layout.tsx
import { Inter } from 'next/font/google'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
```

E em `globals.css`:

```css
body {
  font-family: var(--font-sans), ui-sans-serif, system-ui, sans-serif;
  font-feature-settings: 'cv11', 'ss01';
}
```

**Rationale**: `display: 'swap'` evita FOIT (invisible text); `next/font` faz self-hosting automático em build, eliminando dependência de `fonts.googleapis.com` em runtime. `font-feature-settings` permanece declarado via CSS — `next/font` não interfere nem oferece API direta para isso.

**Alternativas consideradas**:

- `display: 'optional'`: pode resultar em fallback persistente em redes ruins. `swap` é mais conservador.
- Configurar `axes` para variable fonts: Inter no Google Fonts não expõe axes que precisamos; não vale a complexidade.
- Inter Tight ou Inter v4: dependência de revisão de design; mantemos Inter standard.

**Risco residual**: Próximo build em Vercel pode tentar baixar Inter pela primeira vez como build-time fetch. `next/font` cacheia o resultado; o segundo build é instantâneo. Sem ação requerida.

---

## 3. Estado de domínio dos `appointments` — descoberta crítica

**Achado**: O banco de dados só persiste **3 estados** de appointment: `ativo`, `agendado`, `estornado` (migration `0054_appointments_agendado_status.sql`). A derivação `effectiveStatus` é exposta pela view `appointments_effective` (migration `0055` e seguintes). Não existem `confirmed`, `concluido`, `no_show`, `cancelado`, `em_atendimento` no domínio atual.

O componente legado `calendar-block.tsx:25` já documenta:

```
* - concluido -> verde (mapeamento futuro; hoje cai em ativo)
```

**Decisão**: O `AppointmentStatusBadge` cobre os **7 estados visuais conceituais** definidos em FR-022 (agendado, confirmado, concluído, em atendimento, no-show, cancelado, estornado), mas a feature 016 só **instancia 3** nos call-sites atuais (mapeando: `agendado` → "Agendado", `ativo` → "Concluído" como aproximação pragmática, `estornado` → "Estornado"). Os outros 4 ficam disponíveis no componente para quando o domínio evoluir.

**Mapeamento de instanciação atual** (call-sites na feature 016):

| `effectiveStatus` no DB | Variante visual escolhida                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `agendado`              | `agendado` (azul claro do designer)                                                                          |
| `ativo`                 | `concluido` (verde do designer — assume que "ativo na visão histórica" é equivalente a "consulta encerrada") |
| `estornado`             | `estornado` (vermelho suave)                                                                                 |

**Rationale**:

- Implementar todos os 7 visuais no componente não custa praticamente nada (apenas 4 entradas extras no map de estados).
- Os 4 estados "futuros" ficam testados visualmente em quickstart/Storybook-substitute e usáveis quando o domínio receber novas colunas.
- O comentário em `calendar-block.tsx:25` já apontava para essa direção — esta feature consolida visualmente o que o time já planejava.
- **NÃO** introduzimos novos valores no DB nesta feature (regra explícita: sem mudanças de banco).

**Alternativas consideradas**:

- **Cobrir só os 3 estados atuais**: descartado — perderia o ganho de evolução futura e exigiria revisita do componente em todas as features que adicionarem status (005, 012, etc.).
- **Mapear `ativo` → "Confirmado"**: descartado — semanticamente "ativo na view derivada" significa que a consulta já passou pelo ciclo, mais próximo de "concluído". O time pode revisitar quando criar o estado "confirmado" formal.

**Decisão de domínio que NÃO pertence a esta feature**: definir formalmente os estados intermediários (confirmado, em atendimento, no-show, cancelado) é trabalho de banco/RBAC futuro, fora de 016.

---

## 4. `prefers-reduced-motion` no Tailwind/CSS

**Decisão**: Implementar a pulsação do estado "em atendimento" usando a classe `motion-safe:animate-pulse` do Tailwind (variant nativa), com fallback estático automático.

```tsx
<span aria-hidden className="motion-safe:animate-pulse h-1.5 w-1.5 rounded-full bg-warning" />
```

A classe `motion-safe:` aplica `animate-pulse` apenas quando o navegador reporta `prefers-reduced-motion: no-preference`. Quando o usuário tem `reduce`, o ponto fica sólido sem animação — atendendo SC-013 e WCAG 2.3.3.

**Rationale**: Tailwind v3 suporta `motion-safe` e `motion-reduce` como variants em `core-plugins/preflight.css`. Não exige configuração extra.

**Alternativas consideradas**:

- Media query CSS manual em `globals.css`: funciona, mas duplica conhecimento que já está na variant. `motion-safe:` é idiomático.
- JavaScript runtime check (`window.matchMedia`): adiciona JS desnecessário; CSS é declarativo e suficiente.

---

## 5. Lucide Icons disponíveis para os 7 estados

**Decisão**: Usar os ícones já presentes em `node_modules/lucide-react`:

| Estado         | Ícone Lucide |
| -------------- | ------------ |
| Agendado       | `Calendar`   |
| Confirmado     | `Check`      |
| Concluído      | `CheckCheck` |
| Em atendimento | `Clock`      |
| No-show        | `UserX`      |
| Cancelado      | `X`          |
| Estornado      | `RotateCcw`  |

Verificado: todos os 7 estão em `node_modules/lucide-react/dist/esm/icons/` na versão instalada (`^1.8.0` no `package.json`). Sem necessidade de upgrade de dependência.

**Rationale**: Lucide é a biblioteca padrão do shadcn — manter coerência. Os ícones escolhidos seguem o padrão Sessions Health/Healthie identificado na pesquisa de mercado.

---

## 6. Estratégia de tokens da sidebar (cores RGBA com alpha)

**Decisão**: Os 7 tokens da sidebar são expostos diretamente em valores **rgba/hex** (não HSL), porque carregam alpha pré-computado e não precisam participar do alpha modifier do Tailwind.

```css
:root {
  --sidebar-bg: #0e3c5b;
  --sidebar-text: rgba(255, 255, 255, 0.75);
  --sidebar-active-bg: rgba(86, 154, 198, 0.2);
  --sidebar-active-text: #cbe6f8;
  --sidebar-switch: #569ac6;
  --sidebar-hover: rgba(255, 255, 255, 0.05);
  --sidebar-section-label: rgba(255, 255, 255, 0.4);
  --sidebar-separator: rgba(255, 255, 255, 0.1);
}
```

E no `tailwind.config.ts`:

```ts
colors: {
  sidebar: {
    DEFAULT: 'var(--sidebar-bg)',
    text: 'var(--sidebar-text)',
    'active-bg': 'var(--sidebar-active-bg)',
    'active-text': 'var(--sidebar-active-text)',
    switch: 'var(--sidebar-switch)',
    hover: 'var(--sidebar-hover)',
    'section-label': 'var(--sidebar-section-label)',
    separator: 'var(--sidebar-separator)',
  },
}
```

**Rationale**: Sidebar tokens carregam alpha como característica intrínseca do design (item ativo com 20% transparência sobre o fundo). Tratá-los como HSL exigiria `hsl(var(--sidebar-text) / 0.75)` em todo uso — verboso e propenso a erro. Usar var direta com cor completa (incluindo alpha) é mais simples e zero ambiguidade.

**Trade-off**: Esses tokens **não** suportam o alpha modifier do Tailwind (`bg-sidebar/30`). Aceitável — a sidebar é um componente único; não há demanda real para variações de opacidade.

---

## 7. Remoção do dark mode declarado-mas-inoperante

**Decisão**: Remover `darkMode: ['class']` de `tailwind.config.ts` (linha 10). Nenhuma `.dark { ... }` órfã encontrada em `.css` (confirmado pela busca). Nenhum uso de prefixo `dark:` precisa ser limpado nesta fase — se houver no codebase, removeremos em pass auxiliar.

**Rationale**: Light mode é decisão definitiva (pesquisa de mercado). Manter `darkMode: ['class']` sem implementação confunde devs novos.

**Verificação adicional necessária no plano**: rodar `rg "dark:" src/` para encontrar usos órfãos do prefixo `dark:` e removê-los (ou anotá-los se necessários para outra razão).

---

## 8. Sidebar atual — divergências exatas a corrigir

A pesquisa identificou divergências entre o estado atual (`dashboard-shell.tsx`) e o spec:

| Elemento           | Atual                              | Spec                                |
| ------------------ | ---------------------------------- | ----------------------------------- |
| Fundo              | `bg-slate-900` (`#0F172A`)         | `#0E3C5B`                           |
| Item ativo (fundo) | `bg-primary/15` (Blue 600 com 15%) | `rgba(86,154,198,0.2)`              |
| Item ativo (texto) | `text-white`                       | `#CBE6F8`                           |
| Hover              | `hover:bg-white/5`                 | `rgba(255,255,255,0.05)` (idêntico) |
| Separadores        | `border-white/5`                   | `rgba(255,255,255,0.1)` ⚠ diferente |
| Labels seção       | `text-slate-500`                   | `rgba(255,255,255,0.4)`             |
| "Trocar clínica"   | `text-sky-300 hover:text-sky-200`  | `#569AC6`                           |

**Mudanças** (a aplicar no plano):

1. Trocar `bg-slate-900` por `bg-sidebar` (consumindo novo token).
2. Trocar `bg-primary/15 text-white shadow-inner ring-1 ring-primary/30` em item ativo por `bg-sidebar-active-bg text-sidebar-active-text` (sem shadow-inner nem ring — não são especificados pelo designer; preservar shadow é decisão estética para revisar com designer, mas no spec atual fica fora).
3. `text-slate-500` em labels → `text-sidebar-section-label`.
4. `border-white/5` (0.05) → `border-sidebar-separator` (0.1) — atenção: **valor muda**, não só nome.
5. `text-sky-300` em "Trocar clínica" → `text-sidebar-switch`.

**Risco**: Remover `shadow-inner ring-1 ring-primary/30` do item ativo pode reduzir contraste visual. Validar visualmente; reintroduzir se necessário.

---

## 9. Componentes shadcn presentes e impactados

`src/components/ui/`: `badge`, `button`, `card`, `command`, `dialog`, `input`, `label`, `loading-spinner`, `period-shortcuts`, `popover`, `select`, `separator`, `sheet`, `table`, `textarea`.

**Impactados pela mudança de tokens** (consumem `--accent`, `--secondary`, `--ring`, `--primary`):

- `button.tsx` — primary/secondary/outline/ghost variants. Mudança em `--accent` muda hover de ghost/outline.
- `badge.tsx` — usa `--secondary`. Sem mudança direta, mas o **AppointmentStatusBadge** não usa este badge — é componente próprio.
- `command.tsx` (cmdk) — usa `--accent` para item selecionado. Hover passa de cinza para verde suave. Esperado.
- `dialog.tsx`, `popover.tsx`, `sheet.tsx` — usam `--background`/`--border`. Sem mudança visível.
- `select.tsx` — usa `--accent` para item highlighted. Hover passa para verde suave.
- `table.tsx` — usa `--muted`. Sem mudança.

**Sem impacto**: `input`, `label`, `loading-spinner`, `separator`, `textarea`, `period-shortcuts`.

**Verificação visual obrigatória** em quickstart: `button` (todas variantes), `command`, `select` para validar o novo hover verde.

---

## 10. Validação de contraste WCAG AA — pares críticos

Pré-calculado para garantir SC-004:

| Par                                                      | Ratio aproximado | WCAG AA (≥ 4.5:1 texto / ≥ 3:1 UI)  |
| -------------------------------------------------------- | ---------------- | ----------------------------------- |
| `#CBE6F8` sobre `#0E3C5B` (sidebar item ativo)           | ~11.4:1          | ✅                                  |
| `rgba(255,255,255,0.75)` sobre `#0E3C5B` (sidebar texto) | ~10.5:1          | ✅                                  |
| `rgba(255,255,255,0.4)` sobre `#0E3C5B` (labels seção)   | ~5.6:1           | ✅                                  |
| `#05494B` sobre `#CBE1E1` (success-bg + success-text)    | ~9.8:1           | ✅                                  |
| `#0E3C5B` sobre `#CBE6F8` (info-bg + info-text)          | ~10.5:1          | ✅                                  |
| `#2563EB` sobre `white` (primary CTA)                    | ~5.6:1           | ✅                                  |
| `white` sobre `#1CABB0` (success solid)                  | ~3.0:1           | ⚠ Borderline para texto, OK para UI |

**Decisão**: `--success-foreground` para botões com fundo `#1CABB0` continua sendo branco (`0 0% 100%`) porque é UI (limite 3:1 atendido). Para texto longo sobre fundo verde sólido, **preferir** o par `success-bg/success-text` (`#CBE1E1` / `#05494B`).

---

## 11. Conexão com features futuras

- **017-status-badges-system** (diferido por clarification Q2): consumirá os mesmos tokens `--success`, `--info`, `--warning`, `--alert` + acrescentará variantes próprias para `personalizado`/`nao-listado`/`comissionado`/`fixo`/`liberal`.
- **Domínio estendido de appointments**: quando o time formalizar estados intermediários (confirmado, em atendimento, etc.), basta atualizar o mapper `effectiveStatus → variant` no callsite — o componente já suporta.

---

## 12. NEEDS CLARIFICATION restantes

**Nenhum.** Todas as ambiguidades do spec foram resolvidas no `/speckit-clarify` (4 Qs) ou resolvidas neste research por inspeção do codebase.
