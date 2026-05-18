# Contract — Escala Tipográfica

**Localização**: `src/app/globals.css` (classes utilitárias `@layer components`).
**Consumidor**: qualquer componente do produto.
**Replaces**: usos ad-hoc de `text-lg`, `text-xl`, `text-2xl`, `text-sm`, `text-xs` com decisões locais não documentadas (auditados como parte da implementação).

---

## Classes canônicas

```css
@layer components {
  .text-display {
    font-size: 28px;
    font-weight: 500;
    line-height: 1.3;
  }

  .text-h1 {
    font-size: 22px;
    font-weight: 500;
    line-height: 1.4;
  }

  .text-h2 {
    font-size: 18px;
    font-weight: 500;
    line-height: 1.5;
  }

  .text-h3 {
    font-size: 16px;
    font-weight: 500;
    line-height: 1.5;
  }

  .text-body {
    font-size: 14px;
    font-weight: 400;
    line-height: 1.6;
  }

  .text-caption {
    font-size: 12px;
    font-weight: 400;
    line-height: 1.5;
  }

  .text-mono {
    font-size: 13px;
    font-weight: 400;
    line-height: 1.4;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }
}
```

---

## Regras de uso

| Caso | Classe |
|---|---|
| Título de página | `text-display` |
| Cabeçalho de seção dentro de página | `text-h1` ou `text-h2` |
| Card title | `text-h3` |
| Corpo de texto, descrições, formulários | `text-body` |
| Labels auxiliares, badges, hint text | `text-caption` |
| Dados clínicos: dose, CPF, valores, IDs | `text-mono` |
| Rótulo de métrica em densidade alta (ex.: célula de calendário) | `text-caption` + override local `text-[11px]` — **única exceção autorizada** |

---

## Regras de validação (verificáveis na implementação)

1. **Mínimo 12px**: nenhum texto do produto principal deve ficar abaixo de 12px, **exceto** rótulos de métrica em listas/calendário (11px).
2. **Tailwind utility classes pré-existentes** (`text-xs`, `text-sm`, `text-base`, `text-lg`...): **não são proibidas**, mas para novo código, preferir as classes da escala. Migração de usos existentes é trabalho de longo prazo, fora do escopo de 016 — exceto onde o callsite for tocado por outra US desta feature.
3. **Weight não inferior a 400** para corpo de texto. Negrito é decisão local; não usar weights < 400 em texto de leitura.
4. **`text-mono`** não usar para corpo de texto longo — é otimizado para dados curtos alinhados em colunas.

---

## Out of scope

- **Componente `<Heading>` / `<Text>`** wrapper: não introduzido nesta feature. As classes utilitárias bastam.
- **Tokens de tamanho variáveis** (responsivos por viewport): não definidos. Se necessário, follow-up.
- **Fontes alternativas além de Inter**: fora do escopo. Inter + mono stack do sistema.
