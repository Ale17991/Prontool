# Contract — Administração do catálogo de status (super-admin / `/admin`)

Catálogo é **global de plataforma**. Todas as rotas de escrita: `requireSuperAdmin()` (`src/lib/auth/platform-admin.ts`) + `createSupabaseServiceClient`. Sem `tenant_id` (entidade global). Mutações gravam `created_by`/`updated_by`/timestamps.

## GET `/api/admin/dental-status`

Lista **todos** os status (ativos e inativos) para gestão.

- **Auth**: `requireSuperAdmin()`.
- **200**: `{ "items": [ { id, code, label, color, icon, scope, tussCodeId, sortOrder, isActive, isSystem, createdAt, updatedAt } ] }` ordenado por `sortOrder`.

## POST `/api/admin/dental-status`

Cria um novo status.

- **Auth**: `requireSuperAdmin()`.
- **Body** (Zod):

```json
{
  "code": "sealant",
  "label": "Selante",
  "color": "#16a34a",
  "icon": "shield",
  "scope": "face",
  "tussCodeId": "uuid opcional (tuss_table='22')",
  "sortOrder": 35
}
```

**Validações**: `code` slug único (`^[a-z][a-z0-9_]*$`); `color` hex `#RRGGBB`; `scope ∈ tooth|face|both`; `tussCodeId` (se enviado) deve existir e ter `tuss_table='22'` (senão **422**).

- **201**: status criado. **409** se `code` já existe.

## PATCH `/api/admin/dental-status/[id]`

Edita / ativa / desativa um status. Não permite alterar `code` nem deletar status `is_system`.

- **Auth**: `requireSuperAdmin()`.
- **Body** (Zod, todos opcionais): `{ label?, color?, icon?, scope?, tussCodeId? (null para limpar), sortOrder?, isActive? }`.
- **200**: status atualizado.
- **422** se tentar mudar `code`; **404** se `id` inexistente.

## Notas

- **Sem DELETE físico**: desativar (`isActive=false`) é o mecanismo de "remoção" (FR-013 — marcações históricas continuam exibidas). Status `is_system` (ex.: `none`) não pode ser desativado nem removido.
- **Disponibilidade no odontograma**: assim que `isActive=true`, o status aparece na paleta de todas as clínicas sem novo deploy (SC-004).
- **TUSS**: associação opcional à tabela 22 (procedimentos), reusando `tuss_codes` (Princípio IV). Preparação para plano de tratamento/faturamento em fase futura.
