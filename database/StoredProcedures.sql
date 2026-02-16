USE Team15_DB;

DROP TRIGGER IF EXISTS trg_driver_org_history;
DROP TRIGGER IF EXISTS trg_driver_dropped_notify;
DROP TRIGGER IF EXISTS trg_driver_application_submit_to_audit;
DROP TRIGGER IF EXISTS trg_driver_application_status_to_audit;
DROP TRIGGER IF EXISTS trg_driver_application_decision_notify;
DROP TRIGGER IF EXISTS trg_login_attempt_to_audit;
DROP TRIGGER IF EXISTS trg_point_transaction_to_audit;
DROP TRIGGER IF EXISTS trg_user_password_change_to_audit;

DELIMITER $$

# Automatically records and updates a driver’s sponsor history 
# whenever the driver’s assigned sponsor changes.
CREATE TRIGGER trg_driver_org_history
AFTER UPDATE ON DRIVERS
FOR EACH ROW
BEGIN
  -- If this update is dropping the driver, let trg_driver_dropped_notify handle history
  IF NOT (OLD.driver_status <> 'dropped' AND NEW.driver_status = 'dropped') THEN

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

# Logs driver application submissions to the AUDITLOG
CREATE TRIGGER trg_driver_application_submit_to_audit
AFTER INSERT ON DRIVERAPPLICATIONS
FOR EACH ROW
BEGIN
  INSERT INTO AUDITLOG (
    action_type,
    actor_user_id,
    actee_user_id,
    org_id,
    attempted_email,
    success,
    details,
    entity_type,
    entity_id
  )
  VALUES (
    'DRIVER_APP_SUBMITTED',
    NEW.user_id,               -- driver submitted their own application
    NEW.user_id,
    NEW.org_id,
    NULL,
    NULL,
    JSON_OBJECT(
      'status', NEW.application_status,
      'is_active', NEW.is_active
    ),
    'DRIVERAPPLICATION',
    NEW.application_id
  );
END$$

# Logs driver application status changes to the AUDITLOG
CREATE TRIGGER trg_driver_application_status_to_audit
AFTER UPDATE ON DRIVERAPPLICATIONS
FOR EACH ROW
BEGIN
  IF OLD.application_status <> NEW.application_status THEN
    INSERT INTO AUDITLOG (
      action_type,
      actor_user_id,
      actee_user_id,
      org_id,
      attempted_email,
      success,
      details,
      entity_type,
      entity_id
    )
    VALUES (
      'DRIVER_APP_STATUS_CHANGE',
      NULL,                     -- unknown at DB level unless you store the actor in the row
      NEW.user_id,
      NEW.org_id,
      NULL,
      NULL,
      JSON_OBJECT(
        'old_status', OLD.application_status,
        'new_status', NEW.application_status,
        'decision_reason', NEW.decision_reason
      ),
      'DRIVERAPPLICATION',
      NEW.application_id
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

# Logs all login attempts to the AUDITLOG
CREATE TRIGGER trg_login_attempt_to_audit
AFTER INSERT ON LOGIN_ATTEMPTS
FOR EACH ROW
BEGIN
  INSERT INTO AUDITLOG (
    action_type,
    actor_user_id,
    actee_user_id,
    org_id,
    attempted_email,
    success,
    details,
    entity_type,
    entity_id
  )
  VALUES (
    'LOGIN_ATTEMPT',
    NULL,
    NEW.user_id,
    NULL,
    NEW.attempted_email,
    NEW.success,
    JSON_OBJECT(
      'ip_address', NEW.ip_address,
      'user_agent', NEW.user_agent
    ),
    'LOGIN_ATTEMPT',
    NEW.attempt_id
  );
END$$

CREATE TRIGGER trg_point_transaction_to_audit
AFTER INSERT ON POINTTRANSACTIONS
FOR EACH ROW
BEGIN
  INSERT INTO AUDITLOG (
    action_type,
    actor_user_id,
    actee_user_id,
    org_id,
    attempted_email,
    success,
    details,
    entity_type,
    entity_id
  )
  VALUES (
    'POINT_CHANGE',
    NEW.actor_user_id,
    NEW.user_id,
    NEW.org_id,
    NULL,
    NULL,
    JSON_OBJECT(
      'point_change', NEW.point_change,
      'reason', NEW.reason
    ),
    'POINT_TRANSACTION',
    NEW.transaction_id
  );
END$$

CREATE TRIGGER trg_user_password_change_to_audit
AFTER UPDATE ON USERS
FOR EACH ROW
BEGIN
  -- Only log when the password actually changes
  IF OLD.password_hash <> NEW.password_hash THEN
    INSERT INTO AUDITLOG (
      action_type,
      actor_user_id,
      actee_user_id,
      org_id,
      attempted_email,
      success,
      details,
      entity_type,
      entity_id
    )
    VALUES (
      'PASSWORD_CHANGE',
      NEW.user_id,      
      NEW.user_id,
      NULL,
      NULL,
      NULL,
      JSON_OBJECT(),
      'USERS',
      NEW.user_id
    );
  END IF;
END$$

DELIMITER ;