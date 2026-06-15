-- Add rejection_note column to mentorship_sessions
ALTER TABLE mentorship_sessions ADD COLUMN IF NOT EXISTS rejection_note TEXT;

-- Note: booking_status is likely a text column, so we can just use new strings like 'pending_rejection_review' and 'cancelled'.
-- If it's an enum, we might need more complex migration, but usually it's text in these setups.
