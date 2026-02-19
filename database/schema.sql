-- Truck Driver Incentive Program Database Schema
-- Team 15

DROP SCHEMA IF EXISTS Team15_DB;
CREATE SCHEMA Team15_DB;
USE Team15_DB;

CREATE TABLE USERS (
  user_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  phone VARCHAR(50),
  status ENUM('active','locked','disabled') NOT NULL DEFAULT 'active',
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE, -- for use in triggers specific to notification type. 
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE LOGIN_ATTEMPTS (
  attempt_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  attempted_email VARCHAR(255) NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  success BOOLEAN NOT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES USERS(user_id)
);

CREATE TABLE SPONSORORGANIZATION (
  org_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  org_name VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  cents_per_point INT NOT NULL DEFAULT 1,
  org_status ENUM('active','disabled') NOT NULL DEFAULT 'active'
);

CREATE TABLE SPONSORUSERS (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,

  FOREIGN KEY (user_id) REFERENCES USERS(user_id),
  FOREIGN KEY (org_id) REFERENCES SPONSORORGANIZATION(org_id)
);

# Subtype of USERS
CREATE TABLE DRIVERS (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  org_id BIGINT UNSIGNED NULL,
  driver_status ENUM('active','dropped') NOT NULL DEFAULT 'active',

  FOREIGN KEY (user_id) REFERENCES USERS(user_id),
  FOREIGN KEY (org_id) REFERENCES SPONSORORGANIZATION(org_id)
);

# Subtype of USERS
CREATE TABLE ADMIN (
  user_id BIGINT UNSIGNED PRIMARY KEY,

  FOREIGN KEY (user_id) REFERENCES USERS(user_id)
);

CREATE TABLE TEAM (
  team_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  role VARCHAR(100) NOT NULL,
  bio VARCHAR(500),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert team members
INSERT INTO TEAM (first_name, last_name, role, bio) VALUES
('Luke', 'Schultz', 'Team Lead', 'Leads the team and oversees project development'),
('Noah', 'Samol', 'Developer', 'Full-stack developer focused on backend systems'),
('Miles', 'Rockow', 'Developer', 'Frontend and UI/UX specialist'),
('Scott', 'Shaffer', 'Developer', 'Database and performance optimization expert'),
('Uyen', 'Nguyen', 'Developer', 'Frontend and UI/UX specialist');

CREATE TABLE DRIVER_SPONSOR_HISTORY (
  history_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  org_id BIGINT UNSIGNED NOT NULL,

  start_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_date DATETIME NULL,
  end_reason VARCHAR(225) NULL,

  FOREIGN KEY (user_id) REFERENCES DRIVERS(user_id),
  FOREIGN KEY (org_id) REFERENCES SPONSORORGANIZATION(org_id)
);


CREATE TABLE DRIVERAPPLICATIONS (
  application_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  org_id BIGINT UNSIGNED NOT NULL,
  application_status ENUM('PENDING','APPROVED','REJECTED','REVOKED') NOT NULL DEFAULT 'PENDING',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  application_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decision_reason VARCHAR(225),
  UNIQUE KEY uq_driver_org_application (user_id, org_id),
  UNIQUE KEY uq_driver_one_active_app (user_id, is_active),

  FOREIGN KEY (user_id) REFERENCES USERS(user_id),
  FOREIGN KEY (org_id) REFERENCES SPONSORORGANIZATION(org_id)
);

CREATE TABLE PURCHASES (
  purchase_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,   -- driver user_id
  org_id BIGINT UNSIGNED NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES DRIVERS(user_id),
  FOREIGN KEY (org_id) REFERENCES SPONSORORGANIZATION(org_id),
  FOREIGN KEY (created_by_user_id) REFERENCES USERS(user_id)
);

CREATE TABLE PURCHASEITEMS (
  purchase_item_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  purchase_id BIGINT UNSIGNED NOT NULL,
  product_id VARCHAR(200) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  product_name VARCHAR(225) NOT NULL,
  points_cost INT NOT NULL,           -- per single unit

  FOREIGN KEY (purchase_id) REFERENCES PURCHASES(purchase_id)
);

CREATE TABLE DRIVERPOINTBALANCES (
  user_id BIGINT UNSIGNED PRIMARY KEY, -- driver user_id
  current_points INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES DRIVERS(user_id)
);

CREATE TABLE POINTTRANSACTIONS (
  transaction_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,      -- driver user_id
  org_id BIGINT UNSIGNED NOT NULL,
  point_change INT NOT NULL,
  reason VARCHAR(225) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actor_user_id BIGINT UNSIGNED NOT NULL,

  CONSTRAINT check_invalid CHECK (point_change <> 0),

  FOREIGN KEY (user_id) REFERENCES DRIVERS(user_id),
  FOREIGN KEY (org_id) REFERENCES SPONSORORGANIZATION(org_id),
  FOREIGN KEY (actor_user_id) REFERENCES USERS(user_id)
);

CREATE TABLE AUDITLOG (
  audit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  action_type VARCHAR(200) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  actee_user_id BIGINT UNSIGNED NULL,
  org_id BIGINT UNSIGNED NULL,
  attempted_email VARCHAR(255) NULL,
  success BOOLEAN NULL,
  details JSON NULL,
  entity_type VARCHAR(50) NULL,
  entity_id BIGINT UNSIGNED NULL,
  time_done TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes VARCHAR(255) NULL,
  
  FOREIGN KEY (actor_user_id) REFERENCES USERS(user_id),
  FOREIGN KEY (actee_user_id) REFERENCES USERS(user_id),
  FOREIGN KEY (org_id) REFERENCES SPONSORORGANIZATION(org_id)
);

CREATE TABLE NOTIFICATIONS (
  notification_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  notification_type VARCHAR(50) NOT NULL,
  message VARCHAR(255) NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  entity_type VARCHAR(50) NULL,
  entity_id BIGINT UNSIGNED NULL,

  FOREIGN KEY (user_id) REFERENCES USERS(user_id)
);