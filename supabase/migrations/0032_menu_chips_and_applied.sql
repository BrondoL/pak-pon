-- POS direct order + per-menu chips feature.
-- Spec: docs/superpowers/specs/2026-07-08-pos-direct-order-with-chips-design.md
--
-- 1. `menu_chips` — variasi/opsi per menu (mis. "Level 3", "+Nasi", "Pisah")
--    dgn optional price_delta & mutex_group. Owner CRUD via menu master.
-- 2. `transaction_items.applied_chips` — snapshot chip yg dipilih kasir saat
--    transaksi (label + price_delta + mutex_group). Snapshot supaya history
--    stabil walau chip config berubah.
-- 3. `transactions.scan_image_path` — pastikan nullable krn POS direct order
--    ga ada foto nota. Idempotent guard (aslinya sudah nullable di 0001, tp
--    defensive check untuk env yg pernah di-tighten manual).

-- 1. menu_chips table
CREATE TABLE menu_chips (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id      uuid NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  label        text NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  price_delta  bigint NOT NULL DEFAULT 0 CHECK (price_delta >= 0),
  mutex_group  text CHECK (mutex_group IS NULL OR length(mutex_group) BETWEEN 1 AND 20),
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (menu_id, label)
);

CREATE INDEX idx_menu_chips_menu_id_sort
  ON menu_chips(menu_id, sort_order);

CREATE TRIGGER trg_menu_chips_updated
  BEFORE UPDATE ON menu_chips
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE menu_chips ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_all_menu_chips ON menu_chips
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. transaction_items.applied_chips
-- Array of { label, price_delta, mutex_group } snapshot. Default [] biar
-- backward-compat dgn row existing.
ALTER TABLE transaction_items
  ADD COLUMN applied_chips jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 3. transactions.scan_image_path nullable — idempotent guard.
-- Aslinya sudah `text` (nullable) di 0001, tp defensive kalau ada env yg
-- pernah di-tighten manual.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions'
      AND column_name = 'scan_image_path'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE transactions ALTER COLUMN scan_image_path DROP NOT NULL;
  END IF;
END $$;
