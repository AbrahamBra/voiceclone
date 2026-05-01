-- 061_business_outcomes_uniq.sql
-- V3.6.5 PR-2 : idempotency on machine-flow feedback (n8n / Breakcold)
--
-- Migration 022 already enforces "one rdv_signed per conversation". For the
-- machine flow (POST /api/v2/feedback), n8n may re-fire on transient retry,
-- so we extend the same idempotency guarantee to the other rdv_* outcomes.
-- A retried webhook now lands as a 23505 unique violation that the endpoint
-- catches and translates into { duplicate: true }, instead of polluting
-- business_outcomes with twin rows.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_rdv_outcome_per_conv_non_signed
  ON business_outcomes(conversation_id, outcome)
  WHERE outcome IN ('rdv_triggered', 'rdv_no_show', 'rdv_lost');
