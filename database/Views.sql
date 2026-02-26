USE Team15_DB;

DROP VIEW IF EXISTS vw_org_notification_history;
DROP VIEW IF EXISTS vw_sponsor_top_drivers_by_points_earned;

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
  COALESCE(SUM(pt.point_change), 0) AS net_points

FROM DRIVERS d
JOIN USERS u
  ON u.user_id = d.user_id
LEFT JOIN POINTTRANSACTIONS pt
  ON pt.user_id = d.user_id
  AND pt.org_id = d.org_id

GROUP BY
  d.org_id, d.user_id, u.email, u.first_name, u.last_name, d.driver_status;
