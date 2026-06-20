-- 0002_seed_menus.sql — menu master dari nota tercetak Pak Pon

INSERT INTO menus (name, category, price, sort_order) VALUES
  -- Makanan
  ('Pecel Lele',              'makanan', 16000, 1),
  ('Ayam goreng',             'makanan', 19000, 2),
  ('Ayam bakar',              'makanan', 19000, 3),
  ('Ayam Kampung goreng',     'makanan', 30000, 4),
  ('Ayam Kampung bakar',      'makanan', 30000, 5),
  ('Bebek goreng',            'makanan', 38000, 6),
  ('Bebek bakar',             'makanan', 38000, 7),
  ('Sop Ayam',                'makanan', 30000, 8),
  ('Sop Sapi',                'makanan', 35000, 9),
  ('Burung Dara goreng',      'makanan', 38000, 10),
  ('Burung Dara bakar',       'makanan', 38000, 11),
  ('Nila goreng',             'makanan', 38000, 12),
  ('Nila bakar',              'makanan', 38000, 13),

  -- Nasi & side
  ('Nasi',                    'nasi',     7000, 1),
  ('Tahu Tempe',              'nasi',     8000, 2),
  ('Pete Goreng',             'nasi',    10000, 3),
  ('Terong',                  'nasi',     7000, 4),
  ('Kol Goreng',              'nasi',     5000, 5),
  ('Sambel Tambahan',         'nasi',     3000, 6),

  -- Minuman
  ('Es Teh',                  'minuman',  6000, 1),
  ('Teh Panas',               'minuman',  5000, 2),
  ('Teh Panas Tawar',         'minuman',  2000, 3),
  ('Es Teh Tawar',            'minuman',  3000, 4),
  ('Es Jeruk',                'minuman', 10000, 5),
  ('Jeruk Panas',             'minuman',  8000, 6),
  ('Es Tawar',                'minuman',  3000, 7),
  ('Es Batu',                 'minuman',  5000, 8),
  ('Mineral Botol',           'minuman',  5000, 9),
  ('Teh Botol Sosro',         'minuman',  7000, 10);
