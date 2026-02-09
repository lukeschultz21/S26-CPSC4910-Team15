USE Team15_DB;

# Sponsor Organizations
INSERT INTO SPONSORORGANIZATION (org_name, org_status)
VALUES
('Acme Logistics', 'active'),
('RoadRunner Transport', 'active');

# Capture org ids
SET @org_acme = (SELECT org_id FROM SPONSORORGANIZATION WHERE org_name = 'Acme Logistics');
SET @org_rr   = (SELECT org_id FROM SPONSORORGANIZATION WHERE org_name = 'RoadRunner Transport');

# Users
INSERT INTO USERS (email, password, first_name, last_name, phone, status)
VALUES
('admin@system.com',    'hashed_pw', 'System', 'Admin',  '555-0001', 'active'),
('sponsor1@acme.com',   'hashed_pw', 'Sarah',  'Sponsor','555-0002', 'active'),
('driver1@test.com',    'hashed_pw', 'Dave',   'Driver', '555-0003', 'active'),
('driver2@test.com',    'hashed_pw', 'Dina',   'Driver', '555-0004', 'active');

# Capture user ids
SET @u_admin   = (SELECT user_id FROM USERS WHERE email = 'admin@system.com');
SET @u_sponsor = (SELECT user_id FROM USERS WHERE email = 'sponsor1@acme.com');
SET @u_driver1 = (SELECT user_id FROM USERS WHERE email = 'driver1@test.com');
SET @u_driver2 = (SELECT user_id FROM USERS WHERE email = 'driver2@test.com');

# Subtypes
# Admin
INSERT INTO ADMIN (user_id)
VALUES (@u_admin);

# Sponsor user 
INSERT INTO SPONSORUSERS (user_id, org_id)
VALUES (@u_sponsor, @org_acme);

# Drivers
INSERT INTO DRIVERS (user_id, org_id, driver_status)
VALUES
(@u_driver1, @org_acme, 'active'),
(@u_driver2, @org_rr,   'active');

# Driver point balances
INSERT INTO DRIVERPOINTBALANCES (user_id, current_points)
VALUES
(@u_driver1, 1000),
(@u_driver2, 500);

# Driver applications
INSERT INTO DRIVERAPPLICATIONS (user_id, org_id, application_status, decision_reason)
VALUES
(@u_driver2, @org_acme, 'PENDING', NULL);

# Point transactions
INSERT INTO POINTTRANSACTIONS (user_id, org_id, point_change, reason, actor_user_id)
VALUES
(@u_driver1, @org_acme, 500,  'Safety bonus', @u_sponsor),
(@u_driver1, @org_acme, -200, 'Purchase redemption', @u_driver1);

# Purchases & items
INSERT INTO PURCHASES (user_id, org_id)
VALUES (@u_driver1, @org_acme);

SET @purchase1 = LAST_INSERT_ID();

INSERT INTO PURCHASEITEMS (purchase_id, product_id, quantity, product_name, points_cost)
VALUES
(@purchase1, 'API-ITEM-001', 1, 'Bluetooth Headset', 300),
(@purchase1, 'API-ITEM-002', 2, 'Travel Mug',        100);

# AuditLog + Notifications (minimal rows only; schema has only IDs)
INSERT INTO AUDITLOG () VALUES ();
INSERT INTO NOTIFICATIONS () VALUES ();