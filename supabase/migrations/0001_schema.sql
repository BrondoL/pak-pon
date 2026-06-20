-- 0001_schema.sql — tables, RLS, storage bucket, trigger

-- 1. Tables
CREATE TABLE menus (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  category    text NOT NULL CHECK (category IN ('makanan', 'nasi', 'minuman')),
  price       bigint NOT NULL CHECK (price >= 0),
  sort_order  int NOT NULL DEFAULT 0,
  is_active   bool NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_image_path     text,
  handwritten_total   bigint,
  status              text NOT NULL CHECK (status IN ('pending_review', 'confirmed')),
  customer_name       text,
  table_no            text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  confirmed_at        timestamptz,
  deleted_at          timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transaction_items (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id          uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  menu_id                 uuid REFERENCES menus(id) ON DELETE SET NULL,
  menu_name_snapshot      text NOT NULL,
  unit_price_snapshot     bigint NOT NULL CHECK (unit_price_snapshot >= 0),
  qty                     int NOT NULL CHECK (qty > 0),
  notes                   text,
  sort_order              int NOT NULL DEFAULT 0
);

-- 2. Indexes
CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX idx_transactions_deleted_at ON transactions(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transaction_items_menu_id ON transaction_items(menu_id);

-- 3. updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_menus_updated BEFORE UPDATE ON menus
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_transactions_updated BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. RLS — authenticated boleh ALL, anon DENY
ALTER TABLE menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_all_menus ON menus
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all_transactions ON transactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all_transaction_items ON transaction_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('notas', 'notas', false)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY auth_all_storage_notas ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'notas') WITH CHECK (bucket_id = 'notas');
