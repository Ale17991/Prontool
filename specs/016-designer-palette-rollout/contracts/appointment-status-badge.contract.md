# Contract — `AppointmentStatusBadge`

**Component**: `src/components/ui/appointment-status-badge.tsx` (novo nesta feature)
**Owner**: Design System
**Replaces**: Estilos inline `statusClass` em `calendar-block.tsx`, `appointments-history-table.tsx`, `filter-bar.tsx` e quaisquer outros call-sites identificados durante a implementação.

---

## Props (interface TypeScript esperada)

```ts
export type AppointmentStatusVariant =
  | 'agendado'
  | 'confirmado'
  | 'concluido'
  | 'em_atendimento'
  | 'no_show'
  | 'cancelado'
  | 'estornado'

export interface AppointmentStatusBadgeProps {
  variant: AppointmentStatusVariant
  /** Render apenas o ícone sem label — para uso em listas muito densas. Default: false. */
  iconOnly?: boolean
  /** Tamanho do componente. Default: 'md'. */
  size?: 'sm' | 'md'
  /** Sobreposição de className para casos extremos (evitar). */
  className?: string
}
```

---

## Mapeamento canônico (sincronizado com `data-model.md` §3)

| `variant` | Label | Ícone | Fundo | Texto | Padrão | Animação |
|---|---|---|---|---|---|---|
| `agendado` | "Agendado" | `Calendar` | `--info-bg` | `--info-text` | sólido | nenhuma |
| `confirmado` | "Confirmado" | `Check` | `--success-bg` | `--success-text` | sólido | nenhuma |
| `concluido` | "Concluído" | `CheckCheck` | `--success-bg` (60% opacidade) | `--success-text` | sólido | nenhuma |
| `em_atendimento` | "Em atendimento" | `Clock` | `--warning` | `--warning-foreground` | sólido | `motion-safe:animate-pulse` no ponto indicador |
| `no_show` | "Não compareceu" | `UserX` | `--muted` | `--muted-foreground` | listrado (CSS `repeating-linear-gradient`) | nenhuma |
| `cancelado` | "Cancelado" | `X` | `--muted` | `--muted-foreground` | borda tracejada (`border-dashed`) | nenhuma |
| `estornado` | "Estornado" | `RotateCcw` | `--alert` (com baixa saturação no fundo) | `--alert-foreground` | sólido | nenhuma |

---

## Mapper de domínio (callsite — não pertence ao componente)

Os call-sites convertem `effectiveStatus` (do banco) → `variant` (do componente). O componente em si **não** conhece o domínio:

```ts
// Em cada callsite (ex.: calendar-block.tsx)
function statusToVariant(effectiveStatus: 'ativo' | 'agendado' | 'estornado'): AppointmentStatusVariant {
  switch (effectiveStatus) {
    case 'agendado':  return 'agendado'
    case 'ativo':     return 'concluido' // ver research.md §3
    case 'estornado': return 'estornado'
  }
}
```

> Os 4 estados não-mapeados hoje (`confirmado`, `em_atendimento`, `no_show`, `cancelado`) ficam acessíveis para domínio futuro sem mudança no componente.

---

## Acceptance behaviors (testáveis em quickstart)

1. **Render por variant**: cada `variant` produz o trio (cor + ícone + label) descrito na tabela canônica, sem fallback silencioso.
2. **`iconOnly`**: quando `true`, o label é ocultado visualmente (`sr-only`) mas permanece em DOM com `aria-label` para leitores de tela.
3. **`size='sm'`**: reduz padding e fonte para 11px (rótulo de métrica — exceção autorizada pela escala tipográfica para densidade em listas).
4. **`size='md'`** (default): fonte `text-caption` (12px), padding adequado para clique confortável.
5. **`em_atendimento` com `prefers-reduced-motion: no-preference`**: indicador pulsante visível (ponto à esquerda do ícone, `motion-safe:animate-pulse`).
6. **`em_atendimento` com `prefers-reduced-motion: reduce`**: ponto estático visível, sem animação. Estado continua distinguível por cor + ícone + label.
7. **`no_show` (listrado)**: padrão CSS visível mesmo sob simulação de daltonismo (deuteranopia + protanopia).
8. **`cancelado` (tracejado)**: borda tracejada visível e distinta de `no_show` mesmo em simulação de daltonismo.
9. **Contraste**: pares cor/foreground atendem WCAG AA — validado pré-implementação em `research.md` §10.
10. **Sem dependência de `--accent` ou `--secondary`**: o componente consome apenas tokens `--info-*`, `--success-*`, `--warning-*`, `--alert-*`, `--muted-*` — explicitando suas dependências para evolução segura do design system.

---

## Out of scope deste contrato

- **Persistência de status**: nenhuma. Componente é puro render.
- **Mapper de domínio**: vive no callsite, não no componente (princípio de separação).
- **Outros badges** (paciente ativo, plano de saúde, comissionamento): cobertos por feature `017-status-badges-system`, diferida.
- **Click handler**: componente é puro display; se a UI precisar de clique no badge, o callsite envolve em `<button>` ou `<Link>`.
