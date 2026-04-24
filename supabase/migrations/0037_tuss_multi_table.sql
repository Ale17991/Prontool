-- 0037 — Suporte a múltiplas tabelas TUSS (22, 19, 20).
--
-- Até a 0036 o catálogo tuss_codes só importava a Tabela 22 (procedimentos).
-- Esta migration adiciona um discriminador de tabela + o campo de fabricante
-- usado em materiais (19) e medicamentos (20), mantendo UNIQUE(code) global
-- (opção B — validada por scripts/check-tuss-collision.mjs: prefixos
-- disjuntos, zero colisão cross-table no mirror charlesfgarcia/tabelas-ans).
--
-- Decisões:
--   1. tuss_table é NOT NULL com DEFAULT '22' e CHECK explícito — qualquer
--      expansão futura (18, 63) precisa de migration pra relaxar o CHECK.
--      Intencional: prefere falhar cedo se o seed tentar inserir tabela
--      não suportada.
--   2. manufacturer é nullable — só faz sentido em 19/20, ausente em 22.
--   3. tuss_table_label é coluna gerada (STORED). Evita hardcode de label
--      em TS/SQL e fica cacheada — a UI pode selecionar direto sem CASE.
--   4. Índice (tuss_table, code): o typeahead vai filtrar por tabela na
--      esmagadora maioria das queries. Mantemos o tuss_codes_code_idx
--      existente pra lookup cross-table (catálogo global + webhook).
--
-- Não toca em procedures.tuss_code — a FK continua single-column contra
-- tuss_codes.code. Se a ANS publicar colisão no futuro, o schema pode
-- migrar pra chave composta em uma migration subsequente.

ALTER TABLE public.tuss_codes
  ADD COLUMN IF NOT EXISTS tuss_table TEXT NOT NULL DEFAULT '22'
    CHECK (tuss_table IN ('19', '20', '22')),
  ADD COLUMN IF NOT EXISTS manufacturer TEXT;

-- Todo conteúdo atual (5851 códigos) é da Tabela 22. O DEFAULT já resolveu
-- isso pros rows existentes via NOT NULL DEFAULT, mas deixamos o UPDATE
-- explícito pra documentação histórica e pra caso alguma row tenha entrado
-- pelo upsert dentro da mesma transação de reset.
UPDATE public.tuss_codes SET tuss_table = '22' WHERE tuss_table IS NULL OR tuss_table = '';

ALTER TABLE public.tuss_codes
  ADD COLUMN IF NOT EXISTS tuss_table_label TEXT
    GENERATED ALWAYS AS (
      CASE tuss_table
        WHEN '22' THEN 'Procedimentos'
        WHEN '19' THEN 'Materiais'
        WHEN '20' THEN 'Medicamentos'
      END
    ) STORED;

CREATE INDEX IF NOT EXISTS tuss_codes_table_idx
  ON public.tuss_codes (tuss_table, code);
