-- ============================================================
-- Seed Data — Loomis Irrigation System
-- Run after schema.sql in the Supabase SQL editor
-- ============================================================

-- ──────────────────────────────────────────────
-- Controllers
-- ──────────────────────────────────────────────

INSERT INTO controllers (id, name, hydrawise_id, has_flow_meter, location) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Garage', NULL, TRUE, 'Garage'),
  ('c0000000-0000-0000-0000-000000000002', 'Pool Equipment', NULL, TRUE, 'Pool equipment pad'),
  ('c0000000-0000-0000-0000-000000000003', 'Barn', NULL, FALSE, 'Barn');

-- ──────────────────────────────────────────────
-- Garage Controller Zones
-- ──────────────────────────────────────────────

INSERT INTO zones (controller_id, relay_id, name, type, gpm, kz_value, is_active) VALUES
  ('c0000000-0000-0000-0000-000000000001', 1, 'Frontyard East Sod', 'sod', 7.8, 1.0, TRUE),
  ('c0000000-0000-0000-0000-000000000001', 2, 'Frontyard West Sod', 'sod', 14.4, 1.0, TRUE),
  ('c0000000-0000-0000-0000-000000000001', 3, 'Backyard East Sod', 'sod', 10.8, 1.0, TRUE),
  ('c0000000-0000-0000-0000-000000000001', 4, 'Backyard West Sod', 'sod', 7.6, 1.0, TRUE),
  ('c0000000-0000-0000-0000-000000000001', 5, 'Dummy Flow Test', 'system', NULL, 1.0, FALSE),
  ('c0000000-0000-0000-0000-000000000001', 6, 'Frontyard Drip', 'drip', 10.4, 1.0, TRUE),
  ('c0000000-0000-0000-0000-000000000001', 7, 'Backyard House Drip', 'drip', 2.8, 1.0, TRUE),
  ('c0000000-0000-0000-0000-000000000001', 8, 'Garden Raised Beds', 'drip', 3.0, 1.0, TRUE),
  ('c0000000-0000-0000-0000-000000000001', 9, 'Viewshed Hedges East', 'drip', 4.0, 1.0, TRUE);

-- ──────────────────────────────────────────────
-- Pool Equipment Controller Zones
-- ──────────────────────────────────────────────

INSERT INTO zones (controller_id, relay_id, name, type, gpm, kz_value, is_active) VALUES
  ('c0000000-0000-0000-0000-000000000002', 1, 'Pool Drip', 'drip', 1.7, 1.0, TRUE),
  ('c0000000-0000-0000-0000-000000000002', 2, 'Soccer West South', 'sod', 9.2, 1.0, TRUE),
  ('c0000000-0000-0000-0000-000000000002', 3, 'Soccer West North', 'sod', 7.0, 1.0, TRUE),
  ('c0000000-0000-0000-0000-000000000002', 4, 'Soccer East South', 'sod', 13.0, 1.0, TRUE),
  ('c0000000-0000-0000-0000-000000000002', 5, 'Soccer East North', 'sod', 9.5, 1.0, TRUE),
  ('c0000000-0000-0000-0000-000000000002', 6, 'Soccer East North2', 'sod', 7.0, 1.0, TRUE),
  ('c0000000-0000-0000-0000-000000000002', 7, 'East Trees South', 'sod', 10.5, 1.0, TRUE),
  ('c0000000-0000-0000-0000-000000000002', 8, 'East Trees North', 'sod', 16.0, 1.0, TRUE),
  ('c0000000-0000-0000-0000-000000000002', 9, 'West Trees Woodpile', 'sod', 12.0, 1.0, TRUE),
  ('c0000000-0000-0000-0000-000000000002', 10, 'West Trees Rocks', 'sod', 11.0, 1.0, TRUE),
  ('c0000000-0000-0000-0000-000000000002', 11, 'West Trees Septic', 'sod', 10.0, 1.0, TRUE);

-- ──────────────────────────────────────────────
-- Barn Controller Zones
-- ──────────────────────────────────────────────

INSERT INTO zones (controller_id, relay_id, name, type, gpm, kz_value, is_active) VALUES
  ('c0000000-0000-0000-0000-000000000003', 5, 'Iris and Street Front Drip', 'drip', NULL, 1.0, TRUE),
  ('c0000000-0000-0000-0000-000000000003', 6, 'Barn Fruit Trees Drip', 'drip', NULL, 1.0, TRUE);

-- ──────────────────────────────────────────────
-- Seed zone_coefficients for all active zones
-- ──────────────────────────────────────────────

INSERT INTO zone_coefficients (zone_id, controller, kz_value, observation_count) VALUES
  -- Garage
  ('Z1', 'Garage', 1.0, 0),
  ('Z2', 'Garage', 1.0, 0),
  ('Z3', 'Garage', 1.0, 0),
  ('Z4', 'Garage', 1.0, 0),
  ('Z6', 'Garage', 1.0, 0),
  ('Z7', 'Garage', 1.0, 0),
  ('Z8', 'Garage', 1.0, 0),
  ('Z9', 'Garage', 1.0, 0),
  -- Pool Equipment
  ('Z1', 'Pool Equipment', 1.0, 0),
  ('Z2', 'Pool Equipment', 1.0, 0),
  ('Z3', 'Pool Equipment', 1.0, 0),
  ('Z4', 'Pool Equipment', 1.0, 0),
  ('Z5', 'Pool Equipment', 1.0, 0),
  ('Z6', 'Pool Equipment', 1.0, 0),
  ('Z7', 'Pool Equipment', 1.0, 0),
  ('Z8', 'Pool Equipment', 1.0, 0),
  ('Z9', 'Pool Equipment', 1.0, 0),
  ('Z10', 'Pool Equipment', 1.0, 0),
  ('Z11', 'Pool Equipment', 1.0, 0),
  -- Barn
  ('Z5', 'Barn', 1.0, 0),
  ('Z6', 'Barn', 1.0, 0);
