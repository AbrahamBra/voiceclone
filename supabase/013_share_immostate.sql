-- 013: Share Immostate persona with Victor and Paolo
-- Run this in Supabase SQL Editor

-- Step 1: Find the IDs we need
-- (Uncomment and run this first to get the actual UUIDs)

/*
SELECT c.id AS client_id, c.name AS client_name, p.id AS persona_id, p.slug, p.name AS persona_name
FROM clients c
LEFT JOIN personas p ON p.client_id = c.id
WHERE c.name ILIKE '%victor%'
   OR c.name ILIKE '%paolo%'
   OR p.slug ILIKE '%immostate%'
   OR p.name ILIKE '%immostate%'
ORDER BY c.name;
*/

-- Step 2: Insert persona_shares (replace UUIDs with real values from Step 1)
-- Victor gets access to Immostate
INSERT INTO persona_shares (persona_id, client_id)
SELECT p.id, c.id
FROM personas p, clients c
WHERE p.slug ILIKE '%immostate%'
  AND c.name ILIKE '%victor%'
ON CONFLICT (persona_id, client_id) DO NOTHING;

-- Paolo gets access to Immostate
INSERT INTO persona_shares (persona_id, client_id)
SELECT p.id, c.id
FROM personas p, clients c
WHERE p.slug ILIKE '%immostate%'
  AND c.name ILIKE '%paolo%'
ON CONFLICT (persona_id, client_id) DO NOTHING;

-- Verify
SELECT ps.*, c.name AS client_name, p.name AS persona_name
FROM persona_shares ps
JOIN clients c ON c.id = ps.client_id
JOIN personas p ON p.id = ps.persona_id
WHERE p.slug ILIKE '%immostate%';
