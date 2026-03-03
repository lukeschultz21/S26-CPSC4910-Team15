USE Team15_DB;

DROP VIEW IF EXISTS vw_org_notification_history;
DROP VIEW IF EXISTS vw_sponsor_top_drivers_by_points_earned;
DROP VIEW IF EXISTS vw_sponsor_driver_point_transactions;
DROP VIEW IF EXISTS vw_sponsor_driver_point_balances;
DROP VIEW IF EXISTS vw_user_notifications;

-- 1) Org-wide notifications for drivers currently in that org
-- NOTE: This is "current org membership" based on DRIVERS.org_id
CREATE VIEW vw_org_notification_history AS
SELECT
  d.org_id,
  n.notification_id,
  n.user_id AS driver_user_id,
  n.notification_type,
  n.message,
  n.is_read,
  n.created_at,
  n.entity_type,
  n.entity_id
FROM NOTIFICATIONS n
JOIN DRIVERS d
  ON d.user_id = n.user_id;
  
-- 2) Sponsor leaderboard/summary by points earned/redeemed/net
CREATE VIEW vw_sponsor_top_drivers_by_points_earned AS
SELECT
  d.org_id,
  d.user_id AS driver_user_id,
  u.email AS driver_email,
  u.first_name,
  u.last_name,
  d.driver_status,

  -- Points earned (only positive transactions)
  COALESCE(SUM(CASE WHEN pt.point_change > 0 THEN pt.point_change ELSE 0 END), 0) AS points_earned_total,

  -- Points redeemed (absolute value of negative transactions)
  COALESCE(SUM(CASE WHEN pt.point_change < 0 THEN -pt.point_change ELSE 0 END), 0) AS points_redeemed_total,

  -- Net points from transactions (earned - redeemed)
  COALESCE(SUM(COALESCE(pt.point_change, 0)), 0) AS net_points

FROM DRIVERS d
JOIN USERS u
  ON u.user_id = d.user_id
LEFT JOIN POINTTRANSACTIONS pt
  ON pt.user_id = d.user_id
  AND pt.org_id = d.org_id
GROUP BY
  d.org_id, d.user_id, u.email, u.first_name, u.last_name, d.driver_status;
  
-- 3) Sponsor driver point transaction HISTORY view (task 15729 / story 15777)
-- Many rows per driver (one per transaction). Filter by org_id in queries.
CREATE VIEW vw_sponsor_driver_point_transactions AS
SELECT
  d.org_id,

  d.user_id AS driver_user_id,
  du.email AS driver_email,
  du.first_name AS driver_first_name,
  du.last_name  AS driver_last_name,
  d.driver_status,

  pt.transaction_id,
  pt.point_change,
  pt.reason,
  pt.created_at,
  pt.actor_user_id,

  au.email AS actor_email,
  au.first_name AS actor_first_name,
  au.last_name  AS actor_last_name

FROM DRIVERS d
JOIN USERS du
  ON du.user_id = d.user_id
LEFT JOIN POINTTRANSACTIONS pt
  ON pt.user_id = d.user_id
  AND pt.org_id = d.org_id
LEFT JOIN USERS au
  ON au.user_id = pt.actor_user_id;

-- 4) Sponsor driver CURRENT BALANCES view (task 15793)
-- One row per driver with current_points (0 if no balance row for some reason)
CREATE VIEW vw_sponsor_driver_point_balances AS
SELECT
  d.org_id,
  d.user_id AS driver_user_id,
  u.email AS driver_email,
  u.first_name,
  u.last_name,
  d.driver_status,
  COALESCE(b.current_points, 0) AS current_points,
  b.updated_at AS balance_updated_at
FROM DRIVERS d
JOIN USERS u
  ON u.user_id = d.user_id
LEFT JOIN DRIVERPOINTBALANCES b
  ON b.user_id = d.user_id;
  
-- 5) "My notifications" view for profile notifications page (story 15753)
-- Filter by user_id in the app query.
CREATE VIEW vw_user_notifications AS
SELECT
  n.notification_id,
  n.user_id,
  n.notification_type,
  n.message,
  n.is_read,
  n.created_at,
  n.entity_type,
  n.entity_id
FROM NOTIFICATIONS n;