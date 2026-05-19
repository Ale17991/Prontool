# Contract — RPC `public_booking_slots`

**Localização**: `supabase/migrations/0084_public_booking.sql`.
**Security**: `SECURITY DEFINER` — roda como dono da função, ignora RLS.
**Grants**: `EXECUTE` para `anon` e `authenticated`. **Revoked** de `PUBLIC`.

---

## Assinatura

```sql
public.public_booking_slots(
  p_slug TEXT,
  p_doctor_id UUID,
  p_procedure_id UUID,
  p_from DATE,
  p_to DATE
) RETURNS TABLE (slot_start TIMESTAMPTZ, slot_end TIMESTAMPTZ)
```

---

## Comportamento

### Caminho feliz

1. Resolve `tenant_id` por slug (filtra por `public_booking_enabled = TRUE`).
2. Valida `doctor_id` está em `public_booking_doctors` do tenant.
3. Valida `procedure_id` está em `public_booking_doctor_procedures` para `(tenant, doctor)`.
4. Lê janela de disponibilidade do médico (`available_weekdays`, `available_from`, `available_until`, `lunch_break_*`).
5. Lê política de antecedência do tenant.
6. Para cada dia em `[max(p_from, hoje + min_hours), min(p_to, hoje + max_days)]`:
   - Pula se dia da semana não está em `available_weekdays`.
   - Gera candidate slots de `duration_minutes` cobrindo janela do dia.
   - Subtrai lunch break.
   - Subtrai `schedule_blocks` cobrindo o slot.
   - Subtrai `appointment_slot_locks` que overlap o slot.
7. Retorna slots livres em ORDER BY slot_start.

### Caminho de falha (RETURN sem erros)

- Slug não existe ou disabled → 0 linhas.
- Médico não publicado → 0 linhas.
- Procedimento não publicado pro médico → 0 linhas.
- Sem disponibilidade na janela → 0 linhas.

**Importante**: a função **não distingue** entre "slug não existe" e "sem slots disponíveis". O Route Handler API faz essa distinção separando passos (resolve_slug → validar pub_doctor_procedure → chamar slots) e retornando 403/404 distintos.

### Validações server-side adicionais (não fazem parte da RPC, mas da rota API)

- `p_to ≤ p_from + 31 days` (anti-DoS — limitar varredura).
- `p_from ≥ today`.
- `p_doctor_id`, `p_procedure_id` UUID válidos.

---

## Performance

### Esperado

- **30 dias × ~20 candidate slots/dia = 600 generate_series rows** por chamada.
- **3 NOT EXISTS subqueries** por slot (lunch break é INLINE, não subquery).
- Índices usados:
  - `appointment_slot_locks (tenant_id, doctor_id, slot_range)` (GIST — para `&&`)
  - `schedule_blocks (tenant_id, doctor_id, block_date)`
  - `public_booking_doctor_procedures (tenant_id, doctor_id, procedure_id)` (PK)

### Target

- **p95 ≤ 200ms** para 30 dias × 8h janela × 30min duração.
- **p99 ≤ 500ms** mesmo com 100 appointments ativos no período.

### Caso patológico

- 365 dias × 5min duração = ~52k slots candidatos. Mitigado pelo cap `p_to ≤ p_from + 31 days` no Route Handler.

---

## Hardening

```sql
REVOKE ALL ON FUNCTION public.public_booking_slots FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_slots(TEXT, UUID, UUID, DATE, DATE) TO anon, authenticated;
ALTER FUNCTION public.public_booking_slots(TEXT, UUID, UUID, DATE, DATE)
  SET search_path = public, pg_temp;
```

- `REVOKE FROM PUBLIC` antes do GRANT explícito (princípio de menor privilégio).
- `SET search_path` impede injection de schema pelo chamador.

---

## Testabilidade

### Teste de contrato (CRÍTICO — princípio constitucional III)

```sql
-- tests/contract/public-booking-tenant-isolation.test.ts equivalente:
-- Tenant A tem slug 'a' com Dr. X publicado oferecendo Procedure P (30min)
-- Tenant B tem slug 'b' com Dr. Y publicado oferecendo Procedure Q (30min)

-- 1. public_booking_slots('a', dr_x, proc_p, hoje, +7d) → retorna slots
-- 2. public_booking_slots('a', dr_y, proc_q, hoje, +7d) → retorna 0 linhas (dr_y é de tenant B)
-- 3. public_booking_slots('b', dr_x, proc_p, hoje, +7d) → retorna 0 linhas (dr_x é de tenant A)
-- 4. public_booking_slots('a', dr_x, proc_q, hoje, +7d) → retorna 0 linhas (proc_q não publicado pro dr_x)
```

Se qualquer linha vazar, **PR é bloqueado** pela trilha de revisão constitucional.

### Teste de slot collision

```sql
-- Concorrente A e B chamam public_booking_slots em paralelo, depois criam appointment no mesmo slot
-- Constraint EXCLUDE em appointment_slot_locks garante 1 sucesso
```

### Teste de janela

```sql
-- min_hours_advance=24, agora=10:00. Tentar criar slot para 11:00 hoje → não aparece em public_booking_slots
-- max_days_advance=7. Tentar criar slot para daqui +8 dias → não aparece
```

---

## Notas de implementação

- A função usa `WHILE LOOP` em PL/pgSQL — não é a forma mais idiomática em SQL. Alternativa: pure SQL com `generate_series(date)` + LATERAL JOIN. Decisão deferida ao plan de implementação — se p95 ficar acima de 200ms na primeira versão, otimizar para pure SQL.
- `EXTRACT(DOW FROM date)` retorna 0-6 (dom-sáb). Confirmar match com `available_weekdays` (mesma convenção 0=dom assumida).
- `slot_range && tstzrange(start, end)` usa operador GIST — exige índice GIST em `appointment_slot_locks.slot_range` (já existente em migration 0055).
