-- Add type column to personas table
-- Supports clone type selection: 'posts', 'dm', or 'both'
ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'both'
  CHECK (type IN ('posts', 'dm', 'both'));
