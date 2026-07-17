# Contract — RPCs de banco (Postgres, SECURITY DEFINER)

Todas validam `jwt_tenant_id()` quando presente e auditam via `log_audit_event`.

## Alteradas

### `attach_materials_to_appointment(p_appointment_id UUID, p_materials JSONB, p_actor UUID)`
Cada item de `p_materials` passa a aceitar:
```json
{ "tuss_code": "…|null", "tuss_description": "…", "quantity": 1,
  "unit_cost_cents": 1200, "material_id": "uuid|null" }
```
- `unit_cost_cents` default 0 (pendência) quando omitido.
- `tuss_code` agora **opcional** (materiais livres). Se presente, triggers exigem tabela 19 vigente.
- `material_id`, se presente, deve pertencer ao mesmo tenant (trigger).
- Erros: `APPOINTMENT_NOT_FOUND`, `APPOINTMENT_REVERSED`, `MATERIAL_TUSS_INVALID`, `MATERIAL_TENANT_MISMATCH`, `MATERIAL_QUANTITY_INVALID`.

### `create_appointment_with_materials(...)`
Mesma extensão de `p_materials` (aceita `unit_cost_cents` e `material_id`).

## Nova

### `set_appointment_material_cost(p_material_row_id UUID, p_unit_cost_cents INTEGER, p_material_id UUID, p_reason TEXT, p_actor UUID)`
Completa/corrige o custo de um material já lançado (caminho de coluna única relaxada).
- Pré: linha existe no tenant do JWT; `p_unit_cost_cents >= 0`; `p_reason` obrigatório (Princípio II).
- Efeito: UPDATE **apenas** de `unit_cost_cents` (e `material_id`). Trigger rejeita qualquer outra coluna.
- Auditoria: `log_audit_event(tenant, 'appointment_materials', row_id, 'cost_updated', old_cost, new_cost, p_reason)`.
- RBAC: chamada só a partir de camada que passou `requireRole('admin'|'financeiro')`.
- Erros: `MATERIAL_ROW_NOT_FOUND`, `MATERIAL_COST_INVALID`, `REASON_REQUIRED`.

## Catálogo (`tenant_materials`) — sem RPC
Não é append-only → CRUD direto via cliente RLS (INSERT/UPDATE filtrados por `tenant_id = jwt_tenant_id()`), com trigger de auditoria e de validação TUSS opcional. DELETE físico proibido (RLS não concede DELETE; desativa via `active=false`).
