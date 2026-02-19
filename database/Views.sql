USE Team15_DB;

DROP VIEW IF EXISTS vw_org_notification_history;

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
