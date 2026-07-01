# US1 — Divergências de aplicação da paleta híbrida

**Tasks**: T011, T012
**Date**: 2026-05-18
**Status**: Validação visual primária **pendente** (manual). Pré-checagem documental abaixo.

## Pré-checagem documental (T012)

Comparação do código implementado vs. `data-model.md` §1:

### Sidebar (US5)

| Elemento           | Esperado (`data-model.md` §5)                         | Implementado (`dashboard-shell.tsx`) | Status |
| ------------------ | ----------------------------------------------------- | ------------------------------------ | ------ |
| Background         | `#0E3C5B` via `--sidebar-bg`                          | `bg-sidebar`                         | ✅     |
| Item ativo (fundo) | `rgba(86,154,198,0.2)` via `--sidebar-active-bg`      | `bg-sidebar-active-bg`               | ✅     |
| Item ativo (texto) | `#CBE6F8` via `--sidebar-active-text`                 | `text-sidebar-active-text`           | ✅     |
| Texto base         | `rgba(255,255,255,0.75)` via `--sidebar-text`         | `text-sidebar-text`                  | ✅     |
| Hover              | `rgba(255,255,255,0.05)` via `--sidebar-hover`        | `bg-sidebar-hover`                   | ✅     |
| Labels seção       | `rgba(255,255,255,0.4)` via `--sidebar-section-label` | `text-sidebar-section-label`         | ✅     |
| Separadores        | `rgba(255,255,255,0.1)` via `--sidebar-separator`     | `border-sidebar-separator`           | ✅     |
| "Trocar clínica"   | `#569AC6` via `--sidebar-switch`                      | `text-sidebar-switch`                | ✅     |

**Divergência conhecida**: shadow-inner + ring-1 do item ativo foram **removidos** (não previstos no spec). Pode ser reintroduzido após revisão visual com designer.

### Badges de status (US2)

| Variante                | Esperado (`data-model.md` §3)           | Implementado                         | Status |
| ----------------------- | --------------------------------------- | ------------------------------------ | ------ |
| Agendado (bg/text)      | `#CBE6F8` / `#0E3C5B`                   | `bg-info-bg text-info-text`          | ✅     |
| Confirmado (bg/text)    | `#CBE1E1` / `#05494B`                   | `bg-success-bg text-success-text`    | ✅     |
| Concluído (bg/text)     | `#CBE1E1` @60% / `#05494B`              | `bg-success-bg/60 text-success-text` | ✅     |
| Em atendimento (motion) | pulse-safe via `prefers-reduced-motion` | `motion-safe:animate-pulse` no ponto | ✅     |
| No-show (padrão)        | listrado                                | `repeating-linear-gradient` inline   | ✅     |
| Cancelado (padrão)      | tracejado                               | `border-dashed`                      | ✅     |
| Estornado (cor)         | vermelho suave                          | `bg-alert/15 text-alert`             | ✅     |

### CTA (preservação de Blue 600)

| Elemento                     | Esperado                                 | Implementado                 | Status |
| ---------------------------- | ---------------------------------------- | ---------------------------- | ------ |
| `--primary`                  | `217 91% 60%` (Blue 600 = `#2563EB`)     | `217 91% 60%` em globals.css | ✅     |
| Botão "Salvar" / "Confirmar" | usa `bg-primary text-primary-foreground` | Inalterado nos consumidores  | ✅     |
| Ring de foco                 | `--ring` = `217 91% 60%`                 | Inalterado                   | ✅     |

## Validação visual pendente (T011, T013, T014)

As 5 telas-chave precisam de inspeção humana em DevTools:

```text
[ ] /login                              — sidebar não aparece; checar CTA "Entrar"
[ ] /                                   — dashboard inicial
[ ] /operacao/atendimentos              — agenda calendário + lista
[ ] /operacao/pacientes/[id]            — ficha do paciente com badges
[ ] /configuracoes                      — área de configuração
```

Para cada tela:

1. Capturar screenshot em `visual-validation/<tela>.png`.
2. Comparar com mockups do designer.
3. Verificar CTA com `bg-primary` em DevTools = `rgb(37, 99, 235)`.
4. Simular daltonismo (deuteranopia + protanopia) — estados continuam distinguíveis.

## Status SC-001 (paleta híbrida fiel)

Implementação cromática: ✅ **PASS** (pré-checagem documental).
Verificação visual humana: ⚠ **Pendente**.
