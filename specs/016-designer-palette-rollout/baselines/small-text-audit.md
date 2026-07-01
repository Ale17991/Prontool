# Auditoria de Texto < 12px

**Tasks**: T038, T039
**Date**: 2026-05-18
**Method**: Grep regex em `src/` por `text-\[1[01]px\]|text-\[0?9px\]|text-\[8px\]`

## Resultados consolidados

| Tamanho       | Ocorrências                                                        | Decisão                                                                                                               |
| ------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `text-[11px]` | ~22                                                                | Aceitos como **rótulos de métrica** (exceção autorizada pela escala) — não migrar                                     |
| `text-[10px]` | ~18                                                                | **Violam FR-007** mas são pré-existentes; migração fora do escopo de 016 (typography-scale.contract.md §Out of scope) |
| `text-[9px]`  | 4 (em `procedimentos-editor.tsx`, `local-procedure-typeahead.tsx`) | **Violam FR-007**; pré-existentes em badges/tags densas; documentado                                                  |
| `text-[8px]`  | 1 (em `calendar-block.tsx:73`, badge "P" para particular)          | **Viola FR-007**; pré-existente em badge de uma única letra; documentado                                              |

## Decisão de escopo

Conforme `contracts/typography-scale.contract.md` §Out of scope:

> "Tailwind utility classes pré-existentes (`text-xs`, `text-sm`, `text-base`, `text-lg`...): **não são proibidas**, mas para novo código, preferir as classes da escala. **Migração de usos existentes é trabalho de longo prazo, fora do escopo de 016** — exceto onde o callsite for tocado por outra US desta feature."

Para esta feature, a entrega é:

1. ✅ Classes utilitárias `text-display`, `text-h1`..`text-mono` disponíveis em `globals.css`.
2. ✅ Documento canônico (`typography-scale.contract.md`) descrevendo quando usar cada classe.
3. ⚠ Migração dos ~40 callsites existentes com `text-[Npx]` < 12px **NÃO** faz parte de 016. Backlog de follow-up.

## Casos especiais documentados

### `calendar-block.tsx:73` — Badge "P" (particular)

```tsx
<span className="ml-1 inline-block rounded border border-amber-300 bg-amber-100 px-1 text-[8px] font-bold uppercase tracking-wider text-amber-900">
  P
</span>
```

8px é extremo, mas o conteúdo é uma única letra ("P" para "particular") embutido inline ao lado do nome do paciente em célula compacta do calendário. Migrar isso requer redesign do card de calendário (US futura).

### `procedimentos-editor.tsx`/`local-procedure-typeahead.tsx` — Tags `9px`

Tags pequenas de classificação ("PERSONALIZADO", "PARCIAL") dentro de typeaheads de procedimento. Mesma situação: micro-texto contextual. Migrar é redesign.

## Recomendação

Abrir issue de follow-up:

- **"Auditoria e migração de texto < 12px"** — varredura completa, decisão tela a tela, possivelmente em conjunto com revisão do designer.

Status do SC-007 (`Nenhum texto da UI principal renderiza abaixo de 12px exceto rótulos de métrica em 11px`):

- ⚠ **Parcial** — a feature 016 entrega o **vocabulário** (classes) e o **piso** (regra), mas não migra todos os callsites existentes. A regra fica registrada para todo código novo e quando esses arquivos forem tocados.

## Inspeção em 10 telas-chave (T039) — Status

**Manual, pendente**. Execução prevista após validação humana em DevTools. Telas a cobrir:
`/login`, `/`, `/operacao/atendimentos`, `/operacao/pacientes`, `/configuracoes`, `/relatorios`, `/financeiro`, `/cadastros`, `/tarefas`, `/integracoes`.
