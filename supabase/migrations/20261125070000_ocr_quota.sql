-- Daily OCR quota per user.
--
-- Reading a photo or a scanned page costs AI quota but no credit, so without a
-- cap any signed-in account could burn the free tier. Pages are counted per
-- user per India-time day; a page that fails to read is given back.

CREATE TABLE public.ocr_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  pages INTEGER NOT NULL DEFAULT 0 CHECK (pages >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

ALTER TABLE public.ocr_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own OCR usage" ON public.ocr_usage FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.ocr_today() RETURNS DATE
LANGUAGE sql STABLE SET search_path = public AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

-- Reserve p_pages pages for today. Returns pages left after the reservation,
-- or -1 (nothing reserved) if it would exceed p_limit.
CREATE OR REPLACE FUNCTION public.reserve_ocr_pages(p_user UUID, p_pages INTEGER, p_limit INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE used INTEGER;
BEGIN
  IF p_pages <= 0 THEN RAISE EXCEPTION 'p_pages must be positive'; END IF;
  INSERT INTO ocr_usage (user_id, day, pages) VALUES (p_user, ocr_today(), 0)
  ON CONFLICT (user_id, day) DO NOTHING;

  UPDATE ocr_usage SET pages = pages + p_pages, updated_at = now()
   WHERE user_id = p_user AND day = ocr_today() AND pages + p_pages <= p_limit
   RETURNING pages INTO used;
  IF used IS NULL THEN RETURN -1; END IF;
  RETURN p_limit - used;
END $$;

-- Give back pages that could not be read.
CREATE OR REPLACE FUNCTION public.release_ocr_pages(p_user UUID, p_pages INTEGER)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE ocr_usage SET pages = GREATEST(0, pages - GREATEST(p_pages, 0)), updated_at = now()
   WHERE user_id = p_user AND day = ocr_today()
$$;

REVOKE ALL ON FUNCTION public.reserve_ocr_pages(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_ocr_pages(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ocr_pages(UUID, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_ocr_pages(UUID, INTEGER) TO service_role;
