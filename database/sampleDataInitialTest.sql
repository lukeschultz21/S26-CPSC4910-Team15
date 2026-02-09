USE Team15_DB;

-- Sample data for testing

-- Creating sponsor organization (Test Trucking Sponsor Org)
INSERT INTO SPONSORORGANIZATION (org_name)
VALUES ('Test Trucking Sponsor Org');

-- Creating a driver user (LeBron James)
INSERT INTO USERS (
    email,
    password,
    first_name,
    last_name,
    phone
)
VALUES (
           'justAKidFromAkron@gmail.com',
           'ILoveBronny9',
           'LeBron',
           'James',
           '111-222-3333'
       );

-- Convert user to driver
INSERT INTO DRIVERS (user_id, org_id)
SELECT u.user_id, o.org_id
FROM USERS u, SPONSORORGANIZATION o
WHERE u.email = 'justAKidFromAkron@gmail.com'
  AND o.org_name = 'Test Trucking Sponsor Org';

-- Create initial point balance of 500
INSERT INTO DRIVERPOINTBALANCES (user_id, current_points)
SELECT user_id, 500
FROM USERS
WHERE email = 'justAKidFromAkron@gmail.com';

-- Create a transaction
INSERT INTO POINTTRANSACTIONS (
    user_id,
    org_id,
    point_change,
    reason,
    actor_user_id
)
SELECT
    u.user_id,
    o.org_id,
    500,
    'Initial signup bonus',
    u.user_id
FROM USERS u, SPONSORORGANIZATION o
WHERE u.email = 'justAKidFromAkron@gmail.com'
  AND o.org_name = 'Test Trucking Sponsor Org';

-- Create a purchase
INSERT INTO PURCHASES (user_id, org_id)
SELECT u.user_id, o.org_id
FROM USERS u, SPONSORORGANIZATION o
WHERE u.email = 'justAKidFromAkron@gmail.com'
  AND o.org_name = 'Test Trucking Sponsor Org';

-- Add a purchase item (Bronny James Jersey)
INSERT INTO PURCHASEITEMS (
    purchase_id,
    product_id,
    quantity,
    product_name,
    points_cost
)
SELECT
    p.purchase_id,
    'PROD001',
    1,
    'Bronny James Jersey',
    200
FROM PURCHASES p
         JOIN USERS u ON p.user_id = u.user_id
WHERE u.email = 'justAKidFromAkron@gmail.com';
