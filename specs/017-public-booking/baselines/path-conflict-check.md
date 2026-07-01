# T005 — Path conflict check

**Task**: T005 (Phase 1)
**Date**: 2026-05-19

Verificação que paths novos a serem criados não colidem com existentes:

| Path                                                     | Estado        | Notas                              |
| -------------------------------------------------------- | ------------- | ---------------------------------- |
| `src/app/agendar/`                                       | ✅ NÃO EXISTE | Pode criar livremente              |
| `src/app/agendar/[slug]/`                                | ✅ NÃO EXISTE | Pode criar                         |
| `src/app/api/public/`                                    | ✅ NÃO EXISTE | Pode criar (`api/public/booking/`) |
| `src/lib/core/public-booking/`                           | ✅ NÃO EXISTE | Pode criar                         |
| `src/components/public-booking/`                         | ✅ NÃO EXISTE | Pode criar                         |
| `src/app/(dashboard)/configuracoes/agendamento-publico/` | ✅ NÃO EXISTE | Pode criar                         |
| `supabase/migrations/0084_*.sql`                         | Verificar     | Próxima migration disponível       |

Sem conflitos.
