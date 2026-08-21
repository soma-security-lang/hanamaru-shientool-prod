-- A visit schedule is a Japan-local business value. Keep the local date and
-- time independently so date-only PDFs never fabricate a UTC instant.
ALTER TABLE visits
  ADD COLUMN scheduled_local_date date NULL,
  ADD COLUMN scheduled_local_time time(0) NULL,
  ADD COLUMN scheduled_timezone varchar(64) NOT NULL DEFAULT 'Asia/Tokyo',
  ADD CONSTRAINT visits_scheduled_timezone_check
    CHECK (scheduled_timezone = 'Asia/Tokyo');

UPDATE visits
   SET scheduled_local_date = (scheduled_at AT TIME ZONE 'Asia/Tokyo')::date,
       scheduled_local_time = (scheduled_at AT TIME ZONE 'Asia/Tokyo')::time(0)
 WHERE scheduled_at IS NOT NULL;

CREATE INDEX visits_local_schedule_idx
  ON visits(organization_id, scheduled_local_date DESC, scheduled_local_time DESC, id DESC)
  WHERE deleted_at IS NULL;
