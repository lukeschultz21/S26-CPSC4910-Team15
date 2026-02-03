-- Truck Driver Incentive Program Database Schema
-- Team 15

DROP SCHEMA IF EXISTS Team15_DB;
CREATE SCHEMA Team15_DB;
USE Team15_DB;

CREATE TABLE USERS (
    user_id INT AUTO_INCREMENT PRIMARY KEY
);

CREATE TABLE SPONSORORGANIZATION (
    sponsorOrganization_id INT AUTO_INCREMENT PRIMARY KEY,
    sponsor_name VARCHAR(100) NOT NULL UNIQUE
);

# Subtype of USERS
CREATE TABLE DRIVERS (
    user_id INT PRIMARY KEY,
    sponsorOrganization_id INT NOT NULL,
    points_earned INT DEFAULT 0,
    account_status INT DEFAULT 1,  # 1 for active, 0 for inactive,

    FOREIGN KEY (user_id) REFERENCES USERS(user_id),
    FOREIGN KEY (sponsorOrganization_id) REFERENCES SPONSORORGANIZATION(sponsorOrganization_id)
);

# Subtype of USERS
CREATE TABLE SPONSORUSERS (
    user_id INT PRIMARY KEY,
    sponsorOrganization_id INT NOT NULL,

    FOREIGN KEY (user_id) REFERENCES USERS(user_id),
    FOREIGN KEY (sponsorOrganization_id) REFERENCES SPONSORORGANIZATION(sponsorOrganization_id)
);

# Subtype of USERS
CREATE TABLE ADMIN (
    user_id INT PRIMARY KEY,

    FOREIGN KEY (user_id) REFERENCES USERS(user_id)
);

CREATE TABLE DRIVERAPPLICATIONS (
    application_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    sponsorOrganization_id INT NOT NULL,
    application_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    reasoning VARCHAR(300),
    application_date DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES USERS(user_id),
    FOREIGN KEY (sponsorOrganization_id) REFERENCES SPONSORORGANIZATION(sponsorOrganization_id)
);




