# Impacto da mudança de tokens nos componentes shadcn/ui

**Task**: T032
**Date**: 2026-05-18

Mudanças aplicadas na Phase 2 (Foundational):
- `--accent`: `210 40% 96%` (slate-100) → `180 22% 84%` (verde suave `#CBE1E1`)
- `--accent-foreground`: `222 47% 11%` (slate-900) → `182 86% 16%` (verde escuro `#05494B`)
- Novos tokens: `success`, `warning`, `info`, `alert` + variantes `*-bg`/`*-text`
- Sidebar tokens (não impactam shadcn diretamente)

## Componentes shadcn em `src/components/ui/`

| Componente | Consome `--accent`? | Esperado pós-mudança | Status |
|---|---|---|---|
| `badge.tsx` | Não (usa cores hardcoded emerald/amber/rose) | Sem mudança visual | ✅ Sem impacto |
| `button.tsx` | Sim — variantes `ghost`, `outline` usam `accent` em hover | Hover passa de cinza para verde suave | ⚠ Mudança visual esperada — validar em DevTools |
| `card.tsx` | Não | Sem mudança | ✅ |
| `command.tsx` (cmdk) | Sim — item selecionado usa `accent` | Item highlighted vira verde suave | ⚠ Mudança esperada |
| `dialog.tsx` | Não (usa `--background`/`--border`) | Sem mudança | ✅ |
| `input.tsx` | Não | Sem mudança | ✅ |
| `label.tsx` | Não | Sem mudança | ✅ |
| `loading-spinner.tsx` | Não | Sem mudança | ✅ |
| `period-shortcuts.tsx` | Eventual hover usa `accent` | Verde suave em hover | ⚠ Mudança esperada |
| `popover.tsx` | Não diretamente | Sem mudança | ✅ |
| `select.tsx` | Sim — item highlighted usa `accent` | Verde suave em hover | ⚠ Mudança esperada |
| `separator.tsx` | Não | Sem mudança | ✅ |
| `sheet.tsx` | Não | Sem mudança | ✅ |
| `table.tsx` | Usa `--muted` para hover de linha (não `accent`) | Sem mudança | ✅ |
| `textarea.tsx` | Não | Sem mudança | ✅ |

## Validação visual pendente (manual)

Os 4 componentes com mudança esperada (`button`, `command`, `select`, `period-shortcuts`) precisam de **revisão visual** em DevTools:

1. `button` ghost/outline — hover sobre o botão deve mostrar fundo verde suave `#CBE1E1` ao invés de cinza claro.
2. `command` (busca/cmdk) — item destacado por teclado/mouse deve mostrar fundo verde.
3. `select` — opção destacada do dropdown deve mostrar fundo verde.
4. `period-shortcuts` — botão de período deve seguir o comportamento de `button` (verde no hover).

**Critério de aceite**: nenhum hover ficou ilegível ou estranho visualmente. Se algum ficar fora do padrão, abrir issue separado (não bloqueia 016).

## Recomendações de follow-up

- **`badge.tsx`** tem variants `success`/`warning`/`destructive` com **cores hardcoded** (emerald/amber/rose). Não consome os novos tokens. Migração desse badge para consumir `--success`/`--warning`/`--alert` ficaria como **feature 017** (badges genéricos do sistema, já diferida).
- Nenhum componente shadcn foi forkado nesta feature (FR-029 mantido — tokens propagam automaticamente).
