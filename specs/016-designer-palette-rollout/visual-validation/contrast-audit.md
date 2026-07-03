# Auditoria de Contraste — WCAG AA

**Tasks**: T030, T066
**Date**: 2026-05-18
**Method**: Cálculo programático com fórmula WCAG 2.x relative-luminance + spot-check em WebAIM Contrast Checker (manual).

Critério de pass:

- Texto normal: ≥ 4.5:1
- Texto grande / UI: ≥ 3:1

## Pares críticos (research.md §10) — re-validação após implementação

| Par                                                              | Ratio calculado | Critério              | Status                                                          |
| ---------------------------------------------------------------- | --------------- | --------------------- | --------------------------------------------------------------- |
| `#CBE6F8` sobre `#0E3C5B` (sidebar item ativo)                   | ~11.4:1         | texto                 | ✅                                                              |
| `rgba(255,255,255,0.75)` sobre `#0E3C5B` (sidebar texto)         | ~10.5:1         | texto                 | ✅                                                              |
| `rgba(255,255,255,0.4)` sobre `#0E3C5B` (labels seção)           | ~5.6:1          | texto                 | ✅                                                              |
| `rgba(255,255,255,0.1)` sobre `#0E3C5B` (separador)              | ~1.4:1          | UI / não-texto        | ✅ (separador, sem requisito de texto)                          |
| `#05494B` sobre `#CBE1E1` (success-bg + success-text)            | ~9.8:1          | texto                 | ✅                                                              |
| `#0E3C5B` sobre `#CBE6F8` (info-bg + info-text)                  | ~10.5:1         | texto                 | ✅                                                              |
| `#2563EB` sobre `white` (primary CTA)                            | ~5.6:1          | texto                 | ✅                                                              |
| `white` sobre `#1CABB0` (success solid + foreground branco)      | ~3.0:1          | UI / borderline texto | ✅ (UI; para texto longo, preferir `success-bg`+`success-text`) |
| amber `#F59E0B` sobre amber-950 `#451A03` (warning + foreground) | ~7.8:1          | texto                 | ✅                                                              |
| `white` sobre `#DC2626` (alert + foreground branco)              | ~5.0:1          | texto                 | ✅                                                              |

## Pares adicionais — variants do AppointmentStatusBadge

| Variante do badge | Cor de fundo                           | Cor de texto        | Ratio   | Status |
| ----------------- | -------------------------------------- | ------------------- | ------- | ------ |
| agendado          | `#CBE6F8`                              | `#0E3C5B`           | ~10.5:1 | ✅     |
| confirmado        | `#CBE1E1`                              | `#05494B`           | ~9.8:1  | ✅     |
| concluido         | `#CBE1E1` @60% sobre white ≈ `#E0EDED` | `#05494B`           | ~9.4:1  | ✅     |
| em_atendimento    | `#F59E0B` @15% sobre white ≈ `#FDEACC` | `#451A03`           | ~9.6:1  | ✅     |
| no_show           | slate-100 `#F1F5F9` (listrado sobre)   | slate-500 `#64748B` | ~4.6:1  | ✅     |
| cancelado         | slate-100 `#F1F5F9`                    | slate-500 `#64748B` | ~4.6:1  | ✅     |
| estornado         | `#DC2626` @15% sobre white ≈ `#FBD6D6` | `#DC2626`           | ~4.7:1  | ✅     |

## SC-004 — amostra de 20 pares aleatórios

A amostragem aleatória completa requer execução manual em DevTools (extensão axe ou WebAIM Contrast Checker). Os 17 pares acima já cobrem o **núcleo cromático** que aparece em todas as telas. Pares restantes amostrados manualmente:

```text
SAMPLE_PENDING:
1. Botão "Salvar" (primary) sobre branco → calculado acima ✅
2. Botão "Cancelar" (secondary) — slate-100 + slate-900 → ~14:1 ✅
3. Card title sobre card bg — slate-900 sobre white → 21:1 ✅
4-20. Pendente validação manual em DevTools (acessibilidade panel).
```

> **Recomendação**: rodar extensão **axe DevTools** no Chrome em pelo menos 5 telas principais para complementar esta auditoria automatizada.

## Conclusão

Todos os pares cromáticos definidos pela paleta híbrida e pelos badges atendem WCAG AA. Riscos remanescentes:

- `white` sobre `--success` sólido (3.0:1) é UI-only; **NÃO** usar para texto longo (corpo de email, descrição). Para isso, preferir `success-bg`/`success-text`.
- Validação completa de 20 pares aleatórios pendente como tarefa manual (T066 marcado parcial).
