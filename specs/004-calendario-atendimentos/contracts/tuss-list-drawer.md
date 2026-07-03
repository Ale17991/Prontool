# Contract — `<TussListDialog>`

**Localização**: `src/components/tuss/tuss-list-dialog.tsx`

## Props

```ts
export interface TussListDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Filtra a busca por tabela TUSS. */
  table: '22' | '19' | '20'
  /** Callback ao selecionar uma linha. Fecha automaticamente. */
  onSelect: (item: TussListItem) => void
  /** Texto inicial da busca; default ''. */
  initialQuery?: string
}

export interface TussListItem {
  code: string
  description: string
  tussTable: '22' | '19' | '20'
  manufacturer: string | null
}
```

## Comportamento

1. Abre como `<Dialog>` shadcn em `max-w-3xl`.
2. Header: título "Catálogo TUSS — Tabela {table}" + campo de busca com `placeholder="Buscar por código ou nome…"` (debounce 250ms).
3. Body: `<Table>` com colunas:
   - **TUSS** (mono, bold) — `item.code`
   - **Nome completo** (até 2 linhas, sem truncar) — `item.description`
   - **Tabela** — badge usando `<TussTableBadge table={item.tussTable} />`
4. Cada linha tem `onClick` que chama `onSelect(item)` e fecha o dialog.
5. **Paginação client-side**: 20 linhas por página. Footer com:
   - Botão "Anterior" (disabled na página 1)
   - Indicador "Página X de Y · {total} resultados"
   - Botão "Próxima" (disabled na última página)
6. Quando o usuário avança paginação client-side e atinge 80% do buffer (160 de 200), faz nova fetch com `offset` (não suportado hoje no endpoint — OUT OF SCOPE; alternativa: forçar busca mais específica). Decisão: nesta entrega, **sem offset**; usuário recebe banner "Mostrando 200 primeiros — refine a busca para ver mais" quando `total === 200`.

## Endpoint consumido

```
GET /api/tuss-codes?q={query}&table={table}&limit=200
```

Já existente. Retorna `TussHit[]`. Componente normaliza para `TussListItem`.

## Acessibilidade

- Foco volta para o trigger ao fechar.
- ESC fecha.
- Tabela navegável por teclado (Enter seleciona linha focada).

## Integração com typeaheads existentes

Cada formulário com typeahead TUSS ganha um botão "Ver em lista" ao lado do trigger do popover de busca. Ao clicar, abre `<TussListDialog>` passando:

- `table` (do estado do form)
- `initialQuery` (último termo digitado)
- `onSelect` que aplica a seleção (mesmo handler do popover)

Locais a integrar:

1. `/cadastros/procedimentos` (formulário "Novo procedimento")
2. `/operacao/atendimentos/novo` (formulário "Novo atendimento") — atual usa `<Select>`; trocar por typeahead + "Ver em lista".
3. `/operacao/pacientes/[id]` (formulário "Nova etapa" do plano de tratamento) — atual usa lista filtrada inline; substituir pelo typeahead compartilhado.

## Testes

- **Unit**: paginação funciona com 25, 200, 0 itens.
- **Integration (Playwright)**: abrir o dialog, buscar "Restauração", paginar para página 2, selecionar linha, verificar que o form externo recebeu o item.
