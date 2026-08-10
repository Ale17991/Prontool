-- 0194 — Catálogo TUSS completo, direto da fonte oficial da ANS.
--
-- MOTIVO
-- ------
-- Até aqui o catálogo vinha do espelho comunitário `charlesfgarcia/tabelas-ans`
-- (ver docs/data-sources.md). Esse espelho parou de acompanhar a ANS: a Tabela
-- 22 lá tem 5.851 códigos contra 5.967 da versão oficial 202607, e a Tabela 20
-- tem 1.114 contra 44.574. Procedimentos publicados pela ANS depois do último
-- commit do espelho — por exemplo `30310172` (cirurgia antiglaucomatosa via
-- angular, IN 65/2021) e `20101406` (acompanhamento pós-cirurgia fistulizante)
-- — simplesmente não existiam no sistema, e o typeahead não os oferecia.
--
-- A partir desta migration a fonte é o pacote publicado pela própria ANS
-- (`Padrao_TISS_Representacao_de_Conceitos_em_Saude_<versao>.zip`), importado
-- por `pnpm seed:tuss:all`. Três consequências de schema:
--
--   1. A Tabela 18 (diárias, taxas e gases medicinais) passa a ser suportada.
--   2. A planilha oficial traz DATA DE FIM DE VIGÊNCIA, coluna que o espelho
--      não tinha. `valid_to` deixa de ser sempre NULL — o que finalmente dá
--      substância ao trigger `enforce_tuss_code_active_on_procedure` (0024) e
--      ao scan de `detect-deprecated`.
--   3. A Tabela 19 salta de 38.553 para ~1,5 milhão de linhas. Nessa escala a
--      busca `ILIKE '%termo%'` em três colunas vira varredura sequencial, então
--      esta migration cria o índice trigram e move a busca para uma RPC.
--
-- ORDEM IMPORTA: rodar esta migration ANTES do seed. A recriação da coluna
-- gerada `tuss_table_label` reescreve a tabela inteira — barato com 45 mil
-- linhas, caro com 1,5 milhão.

-- =========================================================================
-- 1. Tabela 18 no discriminador
-- =========================================================================

-- O CHECK nasceu inline no ADD COLUMN da 0037, então o nome é o gerado pelo
-- Postgres. Descobrir em vez de chutar mantém a migration idempotente mesmo
-- se algum ambiente tiver recriado a constraint com outro nome.
DO $$
DECLARE
  c TEXT;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'tuss_codes'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%tuss_table%'
  LOOP
    EXECUTE format('ALTER TABLE public.tuss_codes DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.tuss_codes
  ADD CONSTRAINT tuss_codes_tuss_table_check
    CHECK (tuss_table IN ('18', '19', '20', '22'));

-- Coluna gerada não aceita ALTER da expressão: só drop + add.
ALTER TABLE public.tuss_codes DROP COLUMN IF EXISTS tuss_table_label;
ALTER TABLE public.tuss_codes
  ADD COLUMN tuss_table_label TEXT
    GENERATED ALWAYS AS (
      CASE tuss_table
        WHEN '22' THEN 'Procedimentos'
        WHEN '19' THEN 'Materiais'
        WHEN '20' THEN 'Medicamentos'
        WHEN '18' THEN 'Diárias e taxas'
      END
    ) STORED;

COMMENT ON COLUMN public.tuss_codes.tuss_table IS
  'Tabela TUSS de origem: 18 diárias/taxas/gases, 19 materiais e OPME, '
  '20 medicamentos, 22 procedimentos e eventos em saúde. Os prefixos de '
  'código são disjuntos entre as quatro (18 usa 6; 19 usa 7 e a faixa nova de '
  '9 dígitos 1000000xx; 20 usa 9; 22 usa 1-5 e 8) — por isso UNIQUE(code) '
  'segue global. Reverificado contra a versão oficial 202607 por '
  'pnpm check:tuss-collision.';

COMMENT ON COLUMN public.tuss_codes.valid_to IS
  'Data de fim de vigência publicada pela ANS. NULL = vigente. Preenchida a '
  'partir da 0194; antes disso era sempre NULL porque o espelho comunitário '
  'não publicava a coluna.';

-- =========================================================================
-- 2. Busca em escala de 1,5 milhão de linhas
-- =========================================================================

-- `immutable_unaccent` nasceu na 0176 (catálogo de alimentos). Repetido aqui em
-- CREATE OR REPLACE porque em produção as migrations são aplicadas à mão, e
-- esta precisa poder rodar sozinha — sem depender de a 0176 já ter passado.
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
SET search_path = extensions, public
AS $$ SELECT extensions.unaccent('extensions.unaccent', $1) $$;

-- Uma expressão só, indexada uma vez, em vez de três índices e um BitmapOr:
-- o typeahead procura o mesmo termo em código, descrição e fabricante, então
-- concatenar antes de indexar dá o mesmo recall com um terço do espaço e um
-- plano previsível. `immutable_unaccent` (0176) faz "torax" achar "tórax".
CREATE OR REPLACE FUNCTION public.tuss_search_text(
  p_code TEXT,
  p_description TEXT,
  p_manufacturer TEXT
) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  -- coalesce em tudo, não só no fabricante: `immutable_unaccent` é STRICT, e um
  -- único NULL na concatenação apagaria a entrada inteira do índice — a linha
  -- ficaria invisível na busca em vez de dar erro.
  SELECT public.immutable_unaccent(
    lower(
      coalesce(p_code, '') || ' ' ||
      coalesce(p_description, '') || ' ' ||
      coalesce(p_manufacturer, '')
    )
  )
$$;

CREATE INDEX IF NOT EXISTS tuss_codes_search_trgm_idx
  ON public.tuss_codes
  USING gin (
    public.tuss_search_text(code, description, manufacturer) extensions.gin_trgm_ops
  );

-- Índice dos caminhos "sem termo" e "prefixo de código" da RPC.
--
-- `COLLATE "C"` não é detalhe: o banco roda em `en_US.UTF-8`, e nessa collation
-- o Postgres NÃO consegue usar índice B-tree para `LIKE 'prefixo%'` — medido,
-- o plano cai em Parallel Seq Scan. Com a collation C o prefixo volta a ser uma
-- varredura de faixa, e como o ORDER BY usa a MESMA collation o índice também
-- entrega a ordenação: o LIMIT corta cedo em vez de ordenar 1,3 milhão de
-- linhas. Código TUSS é só dígito ASCII, então ordenar em C dá exatamente a
-- mesma sequência que a collation do banco — a troca não muda o que o usuário vê.
-- DROP antes do CREATE (e não `IF NOT EXISTS` sozinho): numa reaplicação sobre
-- um ambiente que rodou uma versão anterior desta migration, `IF NOT EXISTS`
-- manteria em silêncio o índice SEM a collation — que é justamente o que não
-- funciona.
DROP INDEX IF EXISTS public.tuss_codes_active_table_code_idx;
CREATE INDEX tuss_codes_active_table_code_idx
  ON public.tuss_codes (tuss_table, code COLLATE "C")
  WHERE valid_to IS NULL;

-- =========================================================================
-- 3. RPC de busca
-- =========================================================================

-- PostgREST não sabe filtrar por expressão indexada — precisaria de uma coluna
-- materializada (≈150 MB só de texto redundante na 19). Uma RPC resolve sem
-- gastar disco e ainda tira o `or=(...)` de três ramos do lado do cliente.
--
-- SÃO TRÊS CAMINHOS, e juntá-los num SELECT só custou 5,8 s numa medição com
-- 300 mil linhas. Com `ORDER BY code LIMIT 50` na mesma consulta, o planejador
-- prefere varrer o índice de código já ordenado e testar o LIKE linha a linha
-- — ótimo quando quase tudo casa, desastroso quando casam 11 linhas em 300 mil,
-- que é justamente o caso de um typeahead. Daí:
--
--   1. sem termo → consulta ordenada simples, servida pelo índice parcial
--      (tuss_table, code) WHERE valid_to IS NULL. ~0,6 ms.
--   2. termo com menos de 3 caracteres → busca só por PREFIXO DE CÓDIGO, pelo
--      mesmo índice. Não é preguiça: o trigram precisa de 3 caracteres para
--      formar um trigrama, e abaixo disso o índice não pode ser usado — a
--      consulta cairia em varredura completa calculando unaccent em 1,5 milhão
--      de linhas (medido: 3,8 s ao digitar UM caractere). Quem digita "10" quer
--      mesmo é a faixa 10xxxxxx; a busca textual entra no terceiro caractere.
--   3. termo com 3+ caracteres → CTE MATERIALIZED como barreira de otimização,
--      para que o ORDER BY/LIMIT de fora não possa ser empurrado para dentro.
--      O filtro roda primeiro pelo índice trigram (bitmap scan, ~48 ms na mesma
--      massa) e só o resultado é ordenado.
--
-- PL/pgSQL (e não SQL) porque os três caminhos precisam de planos distintos.
--
-- SECURITY INVOKER de propósito: `tuss_codes` é catálogo global com RLS
-- desligada (0016) e SELECT concedido a authenticated/anon (0018). Não há o
-- que elevar aqui, e DEFINER só ampliaria a superfície. Sem `SET search_path`
-- pelo mesmo motivo: todos os nomes já vão qualificados com `public.`.
CREATE OR REPLACE FUNCTION public.search_tuss_codes(
  p_query TEXT DEFAULT NULL,
  p_table TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  code TEXT,
  description TEXT,
  manufacturer TEXT,
  tuss_table TEXT,
  tuss_table_label TEXT,
  terminology_chapter TEXT
)
LANGUAGE plpgsql STABLE PARALLEL SAFE
AS $$
DECLARE
  v_limit INT := greatest(1, least(coalesce(p_limit, 50), 200));
  v_term TEXT := public.immutable_unaccent(lower(btrim(coalesce(p_query, ''))));
  v_pattern TEXT;
  -- Teto do conjunto examinado antes de ordenar. Um termo muito comum
  -- ("cateter") casa dezenas de milhares de linhas na Tabela 19, e materializar
  -- tudo para devolver 50 levou 2 s na medição. Com o teto o custo fica preso a
  -- um múltiplo do que a tela mostra. O corte NÃO é silencioso no sentido que
  -- importa: ele só aparece em termo largo, e some sozinho quando o usuário
  -- digita mais uma letra — que é o que ele vai fazer de qualquer jeito diante
  -- de milhares de resultados.
  v_scan_cap INT := 2000;
BEGIN
  IF v_term = '' THEN
    RETURN QUERY
      SELECT t.code, t.description, t.manufacturer,
             t.tuss_table, t.tuss_table_label, t.terminology_chapter
      FROM public.tuss_codes t
      WHERE t.valid_to IS NULL
        AND (p_table IS NULL OR t.tuss_table = p_table)
      ORDER BY t.code COLLATE "C"
      LIMIT v_limit;
    RETURN;
  END IF;

  IF length(v_term) < 3 THEN
    RETURN QUERY
      SELECT t.code, t.description, t.manufacturer,
             t.tuss_table, t.tuss_table_label, t.terminology_chapter
      FROM public.tuss_codes t
      WHERE t.valid_to IS NULL
        AND (p_table IS NULL OR t.tuss_table = p_table)
        AND t.code COLLATE "C" LIKE regexp_replace(v_term, '([\\%_])', '\\\1', 'g') || '%'
      ORDER BY t.code COLLATE "C"
      LIMIT v_limit;
    RETURN;
  END IF;

  -- `%`, `_` e `\` digitados pelo usuário são texto, não curinga: quem procura
  -- "50%" quer o item que tem "50%" no nome, não a tabela inteira. Sem cláusula
  -- ESCAPE explícita de propósito — a contrabarra já é o escape padrão do LIKE,
  -- e o `~~` cru é o que o índice trigram enxerga.
  v_pattern := '%' || regexp_replace(v_term, '([\\%_])', '\\\1', 'g') || '%';

  RETURN QUERY
    WITH hits AS MATERIALIZED (
      SELECT t.code AS c, t.description AS d, t.manufacturer AS m,
             t.tuss_table AS tt, t.tuss_table_label AS tl,
             t.terminology_chapter AS tc
      FROM public.tuss_codes t
      WHERE t.valid_to IS NULL
        AND (p_table IS NULL OR t.tuss_table = p_table)
        AND public.tuss_search_text(t.code, t.description, t.manufacturer)
            LIKE v_pattern
      LIMIT v_scan_cap
    )
    SELECT h.c, h.d, h.m, h.tt, h.tl, h.tc
    FROM hits h
    ORDER BY h.c COLLATE "C"
    LIMIT v_limit;
END $$;

COMMENT ON FUNCTION public.search_tuss_codes(TEXT, TEXT, INT) IS
  'Busca do typeahead TUSS. LIKE (não ILIKE) sobre a expressão já minúscula e '
  'sem acento — é o que permite o índice trigram entrar. Só devolve códigos '
  'vigentes: código com valid_to preenchido não pode virar procedimento novo '
  '(trigger enforce_tuss_code_active_on_procedure).';

GRANT EXECUTE ON FUNCTION public.search_tuss_codes(TEXT, TEXT, INT) TO authenticated;
