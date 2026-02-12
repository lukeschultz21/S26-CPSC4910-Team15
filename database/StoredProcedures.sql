USE Team15_DB;

DROP TRIGGER IF EXISTS trg_driver_org_history;
DROP TRIGGER IF EXISTS trg_driver_dropped_notify;
DROP TRIGGER IF EXISTS trg_driver_application_decision_notify;

DELIMITER $$

# Automatically records and updates a driver’s sponsor history 
# whenever the driver’s assigned sponsor changes.
CREATE TRIGGER trg_driver_org_history
AFTER UPDATE ON DRIVERS
FOR EACH ROW
BEGIN
  IF (OLD.org_id IS NULL AND NEW.org_id IS NOT NULL)
     OR (OLD.org_id IS NOT NULL AND NEW.org_id IS NULL)
     OR (OLD.org_id IS NOT NULL AND NEW.org_id IS NOT NULL AND OLD.org_id <> NEW.org_id) THEN

    UPDATE DRIVER_SPONSOR_HISTORY
    SET end_date = NOW(),
        end_reason = 'sponsor_changed'
    WHERE user_id = NEW.user_id
      AND end_date IS NULL;

    IF NEW.org_id IS NOT NULL THEN
      INSERT INTO DRIVER_SPONSOR_HISTORY (user_id, org_id, start_date)
      VALUES (NEW.user_id, NEW.org_id, NOW());
    END IF;
  END IF;
END$$

# Automatically closes the driver’s current sponsor affiliation 
# and creates a notification when a driver is marked as dropped.
CREATE TRIGGER trg_driver_dropped_notify
AFTER UPDATE ON DRIVERS
FOR EACH ROW
BEGIN
  IF OLD.driver_status <> 'dropped' AND NEW.driver_status = 'dropped' THEN

    UPDATE DRIVER_SPONSOR_HISTORY
    SET end_date = NOW(),
        end_reason = 'dropped'
    WHERE user_id = NEW.user_id
      AND end_date IS NULL;

    INSERT INTO NOTIFICATIONS (user_id, notification_type, message, entity_type, entity_id)
    VALUES (
      NEW.user_id,
      'DROPPED',
      'You have been dropped by your sponsor.',
      'SPONSORORGANIZATION',
      NEW.org_id
    );
  END IF;
END$$

CREATE TRIGGER trg_driver_application_decision_notify
AFTER UPDATE ON DRIVERAPPLICATIONS
FOR EACH ROW
BEGIN
  -- Fire only when moving from PENDING to a decision state
  IF OLD.application_status = 'PENDING'
     AND NEW.application_status IN ('APPROVED','REJECTED','REVOKED') THEN

    INSERT INTO NOTIFICATIONS (user_id, notification_type, message, entity_type, entity_id)
    VALUES (
      NEW.user_id,
      'APPLICATION_DECISION',
      CONCAT(
        'Your application to sponsor ID ',
        NEW.org_id,
        ' was ',
        NEW.application_status,
        IF(NEW.decision_reason IS NULL OR NEW.decision_reason = '', '', CONCAT(': ', NEW.decision_reason))
      ),
      'DRIVERAPPLICATION',
      NEW.application_id
    );
  END IF;
END$$

# CREATE TRIGGER audit_log_login_attempt
  -- triggers when password database is checked
# END$$

CREATE TRIGGER audit_log_points_change 
AFTER UPDATE ON POINTTRANSACTIONS
BEGIN
  -- triggers when a users points are changed
  INSERT INTO AUDITLOG (action_type, actor_user_id, actee_user_id, org_id, notes)
  VALUES (
    'POINTSTRANSACTION',
    NEW.actor_user_id, -- actor_user_id
    NEW.user_id, -- driver user id
    NEW.org_id, -- sponsor org
    NEW.reason, -- notes
  );
END$$

#CREATE TRIGGER audit_log_driver_application_made 
  -- triggers when driver application is made
#END$$

#CREATE TRIGGER audit_log_driver_application_accepted 
  -- triggers when driver application is accepted
#END$$




DELIMITER ;
