# Simulação de Daltonismo — Pré-checagem do design

**Task**: T014
**Date**: 2026-05-18
**Status**: ⚠ **Validação visual pendente** (DevTools manual)

## Por que o design já é robusto

Cada variante do `AppointmentStatusBadge` combina **3 dimensões** de diferenciação, garantindo distinção mesmo sob simulação de daltonismo:

| Variante | Cor | Ícone | Padrão visual |
|---|---|---|---|
| Agendado | azul claro | `Calendar` | sólido |
| Confirmado | verde suave | `Check` | sólido |
| Concluído | verde suave 60% | `CheckCheck` | sólido + transparência |
| Em atendimento | amber | `Clock` | sólido + **ponto pulsante** |
| No-show | cinza | `UserX` | **listrado** |
| Cancelado | cinza | `X` | **tracejado** |
| Estornado | vermelho suave | `RotateCcw` | sólido + strikethrough no chip do month view |

### Cinza listrado (no_show) vs. cinza tracejado (cancelado)

Estes dois estados são os mais cromaticamente próximos. Sob daltonismo total (acromatopsia), eles **devem** continuar distinguíveis por:
- `no_show` tem `repeating-linear-gradient` (listrado diagonal) — padrão visual permanente.
- `cancelado` tem `border-dashed` — borda tracejada permanente.

A diferença de padrão é geométrica, não cromática. Funciona em acromatopsia.

### Verde suave (confirmado) vs. verde suave 60% (concluído)

Ambos usam `--success-bg`. Distinção:
- `confirmado` = opacidade 100% + ícone `Check`
- `concluido` = opacidade 60% + ícone `CheckCheck` (duplo check, distinto visualmente)

Sob daltonismo verde-vermelho (deuteranopia/protanopia), o verde do designer (`#1CABB0`, mais teal/petróleo) tem boa diferenciação contra slate. **Risco residual**: amber (em atendimento) pode parecer próximo ao verde sob protanopia severa — mas o **ponto pulsante** elimina a ambiguidade.

## Roteiro de validação manual

1. Chrome DevTools → Rendering panel → "Emulate vision deficiencies":
   - **Deuteranopia** — testar agenda calendário, lista, ficha paciente
   - **Protanopia** — mesmas telas
   - **Achromatopsia** (visão total acromática) — confirmar que ícones e padrões (listrado/tracejado) sustentam a diferenciação
2. Para cada simulação: rolar pela agenda do dia e identificar cada estado pela combinação cor+ícone+label.
3. Registrar resultado abaixo:

```text
[ ] Deuteranopia: 7 estados distinguíveis? ___
[ ] Protanopia: 7 estados distinguíveis? ___
[ ] Achromatopsia: 7 estados distinguíveis? ___
```

## Status SC-003

Design **pre-validado**: ✅ (combinação cor+ícone+padrão garante distinção)
Validação humana em DevTools: ⚠ **Pendente**
