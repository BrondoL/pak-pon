-- 0010_print_queue_agent_label.sql — track which agent picked up the job.
-- Agent app populates this when transitioning status to 'printing'/'done'/'failed'.

ALTER TABLE print_queue ADD COLUMN agent_label text;
