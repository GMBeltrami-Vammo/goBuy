-- Reclassifier role: Bruna/Maria (not heads) who assign a new cost center to a
-- charge a head asked to reclassify. Managed via the Admin tab like other roles.
--
-- MUST be applied BEFORE 20260721000005 — a new enum value can't be *used*
-- (in policies/functions) in the same transaction that adds it.
ALTER TYPE finance.app_role ADD VALUE IF NOT EXISTS 'reclassifier';
