-- T-procedures-tuss-fkey: formaliza a FK de procedures.tuss_code →
-- tuss_codes.code. Antes dessa migration a coluna era apenas TEXT — a
-- integridade era garantida apenas pelo trigger BEFORE INSERT da migration
-- 0014. Como consequência, tentativas de embed do PostgREST
-- (`tuss_codes!procedures_tuss_code_fkey(description)`) falhavam com
-- "Could not find a relationship" depois que o schema cache invalidava.
--
-- Essa FK:
--   1. Reforça integridade referencial (sem órfãos por backdoor de service_role)
--   2. Permite o embed do PostgREST, caso algum caller queira voltar a usar
--   3. Mantém a semântica de catálogo global — cross-scope é OK, tuss_codes
--      é read-only e compartilhado por todos os tenants.
--
-- O ON DELETE é RESTRICT porque um procedimento apontando pra um código
-- TUSS removido do catálogo global é um bug de dados, não uma cascata.

ALTER TABLE public.procedures
  ADD CONSTRAINT procedures_tuss_code_fkey
    FOREIGN KEY (tuss_code) REFERENCES public.tuss_codes(code)
    ON DELETE RESTRICT;
