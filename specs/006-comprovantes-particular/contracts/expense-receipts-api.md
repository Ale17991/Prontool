# Contract — Endpoints de comprovantes (`expense_receipts`)

**Locais**: `src/app/api/despesas/[id]/comprovantes/route.ts`, `src/app/api/despesas/[id]/comprovantes/[receiptId]/route.ts`, `src/app/api/despesas/[id]/comprovantes/[receiptId]/url/route.ts`.

## POST /api/despesas/[id]/comprovantes

Upload de um comprovante. Suporta múltiplos arquivos por chamada (campo `files[]`) ou um único (`file`).

**Auth**: `requireRole(['admin', 'financeiro'])`.

**Body** (multipart/form-data):

- `files`: 1+ `File`. PDF/JPG/JPEG/PNG. ≤ 10 MB cada.

**Validações**:

- `expense_id` existe no tenant atual e não está soft-deleted.
- Cada arquivo: tipo permitido, tamanho ≤ 10 MB.
- Path único: se já existe arquivo com mesmo `file_name` na despesa, sufixo `-N` é aplicado.

**Resposta 201**:

```json
{
  "expense_id": "uuid",
  "uploaded": [
    {
      "id": "uuid",
      "file_name": "nota-fiscal.pdf",
      "storage_path": "tenant-uuid/expense-uuid/nota-fiscal.pdf",
      "file_size_bytes": 524288,
      "content_type": "application/pdf",
      "uploaded_at": "2026-04-28T19:00:00Z"
    }
  ]
}
```

**Erros**:

- 400 `INVALID_BODY` — campo `file` ausente ou tipo inválido.
- 404 `EXPENSE_NOT_FOUND` — despesa não existe ou cross-tenant.
- 409 `EXPENSE_DELETED` — despesa soft-deleted.
- 413 `FILE_TOO_LARGE` — arquivo > 10 MB.
- 415 `UNSUPPORTED_MEDIA_TYPE` — extensão/content-type fora de PDF/JPG/PNG.

**Atomicidade**: cada arquivo é upload + INSERT na tabela. Falha individual não aborta os outros — resposta inclui só os bem-sucedidos. Mensagem de erro inclui lista do que falhou (status 207 Multi-Status quando misto).

---

## GET /api/despesas/[id]/comprovantes

Lista comprovantes não-deletados de uma despesa.

**Auth**: `requireRole(['admin', 'financeiro', 'recepcionista', 'profissional_saude'])`.

**Resposta 200**:

```json
{
  "receipts": [
    {
      "id": "uuid",
      "file_name": "nota-fiscal.pdf",
      "file_size_bytes": 524288,
      "content_type": "application/pdf",
      "uploaded_at": "2026-04-28T19:00:00Z",
      "uploaded_by": "uuid",
      "uploaded_by_label": "joao@clinica.test"
    }
  ]
}
```

`uploaded_by_label` vem de um JOIN com `auth.users` (best-effort).

---

## GET /api/despesas/[id]/comprovantes/[receiptId]/url

Retorna URL assinada de 60 s para visualização/download.

**Auth**: `requireRole(['admin', 'financeiro', 'recepcionista', 'profissional_saude'])`.

**Resposta 200**:

```json
{
  "url": "https://supabase.../signed?token=...",
  "file_name": "nota-fiscal.pdf",
  "content_type": "application/pdf"
}
```

**Erros**:

- 404 — receipt não existe ou está soft-deleted.

---

## DELETE /api/despesas/[id]/comprovantes/[receiptId]

Soft-delete. Storage **não é tocado**.

**Auth**: `requireRole(['admin'])`.

**Body** (opcional):

```json
{ "reason": "subido por engano" }
```

**Resposta 204** (sem body).

**Erros**:

- 404 — receipt não existe.
- 409 `RECEIPT_ALREADY_DELETED` — já estava deletado.

**Side-effects**:

- UPDATE `expense_receipts SET deleted_at = now(), deleted_by = $session, deleted_reason = $reason`.
- Trigger AFTER UPDATE → audit_log entry.
- Storage binário inalterado.

---

## Endpoint singular legado APAGADO

`POST/GET/DELETE /api/despesas/[id]/comprovante` (singular, da feature 005-anterior) é removido pela 0059. UI nova consome só os plurais. Antes de mergear, verificar que nenhum cliente externo (Postman saved request, integração futura) depende — contexto: feature foi entregue ontem, sem clientes externos esperados.

## Cenários de teste

1. **Upload múltiplo**: POST com 3 files → 3 entries em `expense_receipts`, 3 objetos no Storage.
2. **Mesmo nome**: POST sequencial com mesmo `file.name` → segundo recebe sufixo `-1`.
3. **Cross-tenant**: tenant A tenta GET com expense_id do tenant B → 404 (RLS oculta).
4. **Tamanho excedido**: POST com 11 MB → 413, sem write.
5. **Soft-delete**: DELETE → row marcada; GET subsequente não retorna; arquivo no Storage ainda existe (verificar com SELECT em `storage.objects`).
6. **Audit**: 1 upload + 1 soft-delete → 2 entries em `audit_log` com `entity='expense_receipts'`.
7. **RBAC financeiro tenta DELETE**: 403.
8. **RBAC recepcionista tenta POST**: 403.
