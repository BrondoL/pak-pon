-- 0009_printer_settings.sql — singleton table for web-side printer rendering settings.
-- Stored on web because the web generates ESC/POS bytes; the agent just forwards them.

CREATE TABLE printer_settings (
  id                     integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  paper_width            text    NOT NULL DEFAULT '58mm'
                                  CHECK (paper_width IN ('58mm', '80mm')),
  feed_lines_before_cut  integer NOT NULL DEFAULT 4
                                  CHECK (feed_lines_before_cut BETWEEN 0 AND 8),
  cut_mode               text    NOT NULL DEFAULT 'full'
                                  CHECK (cut_mode IN ('full', 'partial', 'none')),
  beep_on_print          boolean NOT NULL DEFAULT false,
  header_text            text,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Seed the single row
INSERT INTO printer_settings (id) VALUES (1);

ALTER TABLE printer_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read printer_settings" ON printer_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth update printer_settings" ON printer_settings
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
