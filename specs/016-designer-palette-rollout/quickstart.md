# Quickstart — Usando o Design System 016

Receita prática para devs consumirem o que esta feature entrega. Pareada com `data-model.md` (canônico) e `contracts/` (interfaces).

---

## 1. Usar um token semântico novo

Exemplo: pintar um banner informativo.

```tsx
<div className="bg-info-bg text-info-text rounded-md px-3 py-2">
  Backup automático rodando às 02:00.
</div>
```

Tokens disponíveis (resumo):

- **Sucesso (estado positivo, concluído)**: `bg-success-bg text-success-text` ou `bg-success text-success-foreground`
- **Informativo (neutro, agendado)**: `bg-info-bg text-info-text` ou `bg-info text-info-foreground`
- **Aviso (atrasado, em andamento)**: `bg-warning text-warning-foreground`
- **Alerta clínico (urgência, estorno)**: `bg-alert text-alert-foreground`

> **Lembrete**: para **CTA** (botão primário, link de ação), continue usando `bg-primary text-primary-foreground` — Blue 600 não foi substituído.

---

## 2. Usar o `AppointmentStatusBadge`

Em qualquer call-site que renderize status de consulta:

```tsx
import { AppointmentStatusBadge } from '@/components/ui/appointment-status-badge'

// Sabendo o effectiveStatus do banco (ativo | agendado | estornado):
function statusToVariant(s: 'ativo' | 'agendado' | 'estornado') {
  if (s === 'agendado') return 'agendado' as const
  if (s === 'estornado') return 'estornado' as const
  return 'concluido' as const // 'ativo' do banco mapeia visualmente para "Concluído"
}

;<AppointmentStatusBadge variant={statusToVariant(appointment.effectiveStatus)} />
```

Variantes disponíveis no componente (ver `contracts/appointment-status-badge.contract.md` para mapping canônico):

```
agendado | confirmado | concluido | em_atendimento | no_show | cancelado | estornado
```

Em listas muito densas (calendário, tabela com muitas linhas), use `iconOnly`:

```tsx
<AppointmentStatusBadge variant="agendado" iconOnly size="sm" />
```

---

## 3. Aplicar a escala tipográfica

```tsx
<h1 className="text-display">Faturamento do mês</h1>
<h2 className="text-h2">Atendimentos por convênio</h2>
<p className="text-body">14 atendimentos faturados, R$ 8.420,00 em receita.</p>
<span className="text-caption text-muted-foreground">Atualizado há 3 minutos</span>
<span className="text-mono">CPF: 123.456.789-00</span>
```

Regra de ouro: **nada abaixo de 12px**, exceto rótulos de métrica em densidade extrema (calendário).

---

## 4. Atualizando hover de componentes shadcn

Componentes shadcn que consomem `--accent` (Button ghost/outline, Command, Select) passam a ter **hover verde suave** automaticamente — não há código a mudar. Caso algum hover fique estranho visualmente, validar com designer; **não** sobrescrever `--accent` localmente.

---

## 5. Validação visual pós-deploy

Roteiro mínimo para cada feature/PR que toque UI durante e após 016:

### 5.1 Inspeção em DevTools

Abrir uma página do dashboard e verificar (Computed style):

| Elemento                                   | Valor esperado                     |
| ------------------------------------------ | ---------------------------------- |
| Sidebar `background-color`                 | `rgb(14, 60, 91)` (= `#0E3C5B`)    |
| Botão primário "Salvar" `background-color` | `rgb(37, 99, 235)` (= `#2563EB`)   |
| Badge "Agendado" `background-color`        | `rgb(203, 230, 248)` (= `#CBE6F8`) |
| Badge "Concluído" `color`                  | `rgb(5, 73, 75)` (= `#05494B`)     |

### 5.2 Simulação de daltonismo

Chrome DevTools → Rendering panel → "Emulate vision deficiencies":

1. Selecionar **Deuteranopia**; abrir agenda; verificar que os 7 estados continuam distinguíveis.
2. Selecionar **Protanopia**; mesma verificação.
3. Selecionar **Achromatopsia** (visão acromática); estado deve continuar identificável por ícone + label + padrão visual.

### 5.3 Reduced motion

Chrome DevTools → Rendering panel → "Emulate CSS media feature `prefers-reduced-motion`" → `reduce`:

- Abrir uma consulta em "Em atendimento"; ponto indicador deve aparecer **estático** (sem pulsação).
- Voltar para `no-preference`; pulsação retorna.

### 5.4 Network — fontes externas

DevTools → Network → filtrar por `fonts.googleapis.com`:

- Recarregar dashboard com `Disable cache` ativo.
- **Zero** requisições esperadas para esse domínio.

### 5.5 LCP em 3G emulado

DevTools → Lighthouse → Mobile + Slow 3G:

- Rodar em `/login` e `/` (dashboard).
- LCP deve ser ≥ 100ms menor que a baseline (capturada antes da migração de fonte) **ou** Lighthouse não reportar FOUT.

---

## 6. Onde isso vive no código

| Coisa                                                        | Path                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| Tokens CSS                                                   | `src/app/globals.css`                                 |
| Tailwind extension (tokens consumíveis como utility classes) | `tailwind.config.ts`                                  |
| Migração de fonte                                            | `src/app/layout.tsx`                                  |
| Componente de status                                         | `src/components/ui/appointment-status-badge.tsx`      |
| Sidebar                                                      | `src/app/(dashboard)/_components/dashboard-shell.tsx` |
| Spec, plano, contratos                                       | `specs/016-designer-palette-rollout/`                 |

---

## 7. O que NÃO fazer

- Não criar variantes locais de badges com hex hardcoded. Use `AppointmentStatusBadge` para status de consulta; para badges genéricos do sistema, aguarde feature `017`.
- Não sobrescrever `--accent` ou `--success` em componente isolado.
- Não voltar a usar `@import url('https://fonts.googleapis.com/...')` em nenhum arquivo CSS.
- Não adicionar prefixos `dark:` em novas classes — light mode é definitivo.
- Não substituir `bg-primary` por `bg-success` em botões "Salvar"/"Confirmar". Verde é success, **não** CTA.
