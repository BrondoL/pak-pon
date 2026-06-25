-- 0021_drop_print_queue.sql
-- Phase 3: hapus print_queue setelah migrasi ke FCM-only architecture.
-- Agent Phase 2+ pakai print_history; tidak ada lagi konsumer print_queue.
-- ALTER PUBLICATION dulu supaya realtime subscription hilang clean.
ALTER PUBLICATION supabase_realtime DROP TABLE print_queue;
DROP TABLE IF EXISTS print_queue CASCADE;
