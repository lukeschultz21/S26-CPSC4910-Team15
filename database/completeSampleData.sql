USE Team15_DB;

-- Sponsor Organizations
INSERT INTO SPONSORORGANIZATION (org_name, org_status, cents_per_point)
VALUES
('Acme Logistics', 'active', 1),
('RoadRunner Transport', 'active', 1);

-- Capture org ids
SET @org_acme = (SELECT org_id FROM SPONSORORGANIZATION WHERE org_name = 'Acme Logistics');
SET @org_rr   = (SELECT org_id FROM SPONSORORGANIZATION WHERE org_name = 'RoadRunner Transport');

-- Users  (NOTE: password_hash, not password)
INSERT INTO USERS (email, password_hash, first_name, last_name, phone, status)
VALUES
('admin@system.com',    'hashed_pw', 'System', 'Admin',   '555-0001', 'active'),
('sponsor1@acme.com',   'hashed_pw', 'Sarah',  'Sponsor', '555-0002', 'active'),
('sponsor2@rr.com',     'hashed_pw', 'Ryan',   'Sponsor', '555-0005', 'active'),
('driver1@test.com',    'hashed_pw', 'Dave',   'Driver',  '555-0003', 'active'),
('driver2@test.com',    'hashed_pw', 'Dina',   'Driver',  '555-0004', 'active');

-- Capture user ids
SET @u_admin    = (SELECT user_id FROM USERS WHERE email = 'admin@system.com');
SET @u_sponsor1 = (SELECT user_id FROM USERS WHERE email = 'sponsor1@acme.com');
SET @u_sponsor2 = (SELECT user_id FROM USERS WHERE email = 'sponsor2@rr.com');
SET @u_driver1  = (SELECT user_id FROM USERS WHERE email = 'driver1@test.com');
SET @u_driver2  = (SELECT user_id FROM USERS WHERE email = 'driver2@test.com');

-- Subtypes
-- Admin
INSERT INTO ADMIN (user_id) VALUES (@u_admin);

-- Sponsor users
INSERT INTO SPONSORUSERS (user_id, org_id)
VALUES
(@u_sponsor1, @org_acme),
(@u_sponsor2, @org_rr);

-- Drivers
-- driver1 currently affiliated with Acme
-- driver2 starts with NO sponsor (so she can apply)
INSERT INTO DRIVERS (user_id, org_id, driver_status)
VALUES
(@u_driver1, @org_acme, 'active'),
(@u_driver2, NULL,      'active');

-- Driver Sponsor History (tests "past sponsors" story)
-- driver1 previously with RoadRunner, now with Acme
INSERT INTO DRIVER_SPONSOR_HISTORY (user_id, org_id, start_date, end_date, end_reason)
VALUES
(@u_driver1, @org_rr,  '2025-08-01 00:00:00', '2025-12-01 00:00:00', 'left_program');

INSERT INTO DRIVER_SPONSOR_HISTORY (user_id, org_id, start_date, end_date, end_reason)
VALUES
(@u_driver1, @org_acme, '2025-12-01 00:00:00', NULL, NULL);

-- driver2 has no history yet (not affiliated)

-- Driver point balances
INSERT INTO DRIVERPOINTBALANCES (user_id, current_points)
VALUES
(@u_driver1, 1000),
(@u_driver2, 0);

-- Driver applications (tests one-active-application rule)
-- driver2 applies to Acme (active)
INSERT INTO DRIVERAPPLICATIONS
  (user_id, org_id, application_status, is_active, decision_reason)
VALUES
  (@u_driver2, @org_acme, 'PENDING', TRUE, NULL);

-- Now simulate sponsor decision: deny Acme application (deactivates it)
UPDATE DRIVERAPPLICATIONS
SET application_status = 'REJECTED',
    is_active = FALSE,
    decision_reason = 'No openings'
WHERE user_id = @u_driver2 AND org_id = @org_acme;

-- After denial, driver2 can apply elsewhere (active)
INSERT INTO DRIVERAPPLICATIONS
  (user_id, org_id, application_status, is_active, decision_reason)
VALUES
  (@u_driver2, @org_rr, 'PENDING', TRUE, NULL);

-- Point transactions
INSERT INTO POINTTRANSACTIONS (user_id, org_id, point_change, reason, actor_user_id)
VALUES
(@u_driver1, @org_acme,  500,  'Safety bonus',        @u_sponsor1),
(@u_driver1, @org_acme, -200,  'Purchase redemption', @u_driver1);

-- Purchases & items (tests created_by_user_id requirement)
-- Sponsor user places purchase on behalf of driver1
INSERT INTO PURCHASES (user_id, org_id, created_by_user_id)
VALUES (@u_driver1, @org_acme, @u_sponsor1);

SET @purchase1 = LAST_INSERT_ID();

INSERT INTO PURCHASEITEMS (purchase_id, product_id, quantity, product_name, points_cost)
VALUES
(@purchase1, 'API-ITEM-001', 1, 'Bluetooth Headset', 300),
(@purchase1, 'API-ITEM-002', 2, 'Travel Mug',        100);

-- AuditLog + Notifications (must provide required fields)
INSERT INTO AUDITLOG (action_type, actor_user_id, actee_user_id, org_id, entity_type, entity_id)
VALUES
('DRIVER_APP_SUBMITTED', @u_driver2, @u_driver2, @org_rr,   'DRIVERAPPLICATION', (SELECT application_id FROM DRIVERAPPLICATIONS WHERE user_id=@u_driver2 AND org_id=@org_rr LIMIT 1)),
('POINT_CHANGE',         @u_sponsor1, @u_driver1, @org_acme,'POINTTRANSACTION',  (SELECT transaction_id FROM POINTTRANSACTIONS WHERE user_id=@u_driver1 ORDER BY transaction_id DESC LIMIT 1));

-- Notification: driver dropped alert example (mandatory alert type)
INSERT INTO NOTIFICATIONS (user_id, notification_type, message, entity_type, entity_id)
VALUES
(@u_driver1, 'DROPPED', 'You have been dropped by your sponsor.', 'SPONSORORGANIZATION', @org_acme);

