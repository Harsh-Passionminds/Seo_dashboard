-- Initial schema for MySQL 8.0+ / InnoDB.
-- Apply only to an empty database after confirming the Hostinger SQL engine/version.

CREATE TABLE users (
    user_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    google_sub VARCHAR(255) NOT NULL,
    email VARCHAR(320) NOT NULL,
    display_name VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    UNIQUE KEY uq_users_google_sub (google_sub),
    KEY idx_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE website_credentials (
    website_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    owner_user_id BIGINT UNSIGNED NOT NULL,
    website_name VARCHAR(255) NOT NULL,
    domain_name VARCHAR(2048) NOT NULL,
    ga4_property_id VARCHAR(64) NOT NULL,
    gsc_property_url VARCHAR(2048) NULL,
    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    currency_code CHAR(3) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (website_id),
    UNIQUE KEY uq_owner_ga4_property (owner_user_id, ga4_property_id),
    KEY idx_website_owner_active (owner_user_id, is_active),
    CONSTRAINT fk_website_owner FOREIGN KEY (owner_user_id)
        REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE google_oauth_tokens (
    token_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    google_account_id VARCHAR(255) NOT NULL,
    google_email VARCHAR(320) NULL,
    access_token_encrypted TEXT NULL,
    refresh_token_encrypted TEXT NULL,
    token_type VARCHAR(50) NOT NULL DEFAULT 'Bearer',
    expires_at DATETIME NULL,
    scopes_json JSON NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_refreshed_at DATETIME NULL,
    last_error TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (token_id),
    UNIQUE KEY uq_oauth_user_google_account (user_id, google_account_id),
    KEY idx_oauth_active (user_id, is_active),
    CONSTRAINT fk_oauth_user FOREIGN KEY (user_id)
        REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE google_search_console_data (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    website_id BIGINT UNSIGNED NOT NULL,
    report_date DATE NOT NULL,
    clicks BIGINT UNSIGNED NOT NULL DEFAULT 0,
    impressions BIGINT UNSIGNED NOT NULL DEFAULT 0,
    ctr DECIMAL(12,8) NULL,
    average_position DECIMAL(12,6) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_gsc_website_date (website_id, report_date),
    KEY idx_gsc_date (report_date),
    CONSTRAINT fk_gsc_website FOREIGN KEY (website_id)
        REFERENCES website_credentials(website_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE google_analytics_data (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    website_id BIGINT UNSIGNED NOT NULL,
    report_date DATE NOT NULL,
    organic_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0,
    form_submit_conversions DECIMAL(20,4) NOT NULL DEFAULT 0,
    from_submit_conversions DECIMAL(20,4) NOT NULL DEFAULT 0,
    total_form_conversions DECIMAL(21,4)
        GENERATED ALWAYS AS (form_submit_conversions + from_submit_conversions) STORED,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ga4_website_date (website_id, report_date),
    KEY idx_ga4_date (report_date),
    CONSTRAINT fk_ga4_website FOREIGN KEY (website_id)
        REFERENCES website_credentials(website_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- CREATE TABLE user_acquisition_data (
--     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
--     website_id BIGINT UNSIGNED NOT NULL,
--     report_date DATE NOT NULL,
--     filter_name VARCHAR(255) NOT NULL DEFAULT 'all',
--     first_user_default_channel_group VARCHAR(255) NULL,
--     first_user_source VARCHAR(255) NULL,
--     first_user_medium VARCHAR(255) NULL,
--     first_user_source_medium VARCHAR(512) NULL,
--     first_user_campaign_name VARCHAR(512) NULL,
--     first_user_campaign_id VARCHAR(255) NULL,
--     device_category VARCHAR(100) NULL,
--     country VARCHAR(100) NULL,
--     region VARCHAR(150) NULL,
--     city VARCHAR(150) NULL,
--     total_users DECIMAL(20,4) NOT NULL DEFAULT 0,
--     active_users DECIMAL(20,4) NOT NULL DEFAULT 0,
--     new_users DECIMAL(20,4) NOT NULL DEFAULT 0,
--     returning_users DECIMAL(20,4) NOT NULL DEFAULT 0,
--     engaged_sessions DECIMAL(20,4) NOT NULL DEFAULT 0,
--     engagement_rate DECIMAL(12,8) NULL,
--     average_session_duration DECIMAL(20,6) NULL,
--     conversions DECIMAL(20,4) NOT NULL DEFAULT 0,
--     form_submit_events DECIMAL(20,4) NOT NULL DEFAULT 0,
--     total_revenue DECIMAL(20,4) NOT NULL DEFAULT 0,
--     dimensions_json JSON NULL,
--     metrics_json JSON NULL,
--     dimension_hash CHAR(64) NOT NULL,
--     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
--     PRIMARY KEY (id),
--     UNIQUE KEY uq_user_acq_row (website_id, report_date, dimension_hash),
--     KEY idx_user_acq_date (website_id, report_date),
--     KEY idx_user_acq_filter (website_id, filter_name),
--     KEY idx_user_acq_source (website_id, first_user_source, first_user_medium),
--     KEY idx_user_acq_channel (website_id, first_user_default_channel_group),
--     CONSTRAINT fk_user_acq_website FOREIGN KEY (website_id)
--         REFERENCES website_credentials(website_id) ON DELETE CASCADE
-- ) ENGINE=InnoDB;

-- CREATE TABLE traffic_acquisition_data (
--     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
--     website_id BIGINT UNSIGNED NOT NULL,
--     report_date DATE NOT NULL,
--     filter_name VARCHAR(255) NOT NULL DEFAULT 'all',
--     session_default_channel_group VARCHAR(255) NULL,
--     session_source VARCHAR(255) NULL,
--     session_medium VARCHAR(255) NULL,
--     session_source_medium VARCHAR(512) NULL,
--     session_campaign_name VARCHAR(512) NULL,
--     session_campaign_id VARCHAR(255) NULL,
--     device_category VARCHAR(100) NULL,
--     country VARCHAR(100) NULL,
--     region VARCHAR(150) NULL,
--     city VARCHAR(150) NULL,
--     landing_page_plus_query_string TEXT NULL,
--     sessions DECIMAL(20,4) NOT NULL DEFAULT 0,
--     engaged_sessions DECIMAL(20,4) NOT NULL DEFAULT 0,
--     total_users DECIMAL(20,4) NOT NULL DEFAULT 0,
--     new_users DECIMAL(20,4) NOT NULL DEFAULT 0,
--     returning_users DECIMAL(20,4) NOT NULL DEFAULT 0,
--     engagement_rate DECIMAL(12,8) NULL,
--     average_session_duration DECIMAL(20,6) NULL,
--     events_per_session DECIMAL(20,6) NULL,
--     conversions DECIMAL(20,4) NOT NULL DEFAULT 0,
--     form_submit_events DECIMAL(20,4) NOT NULL DEFAULT 0,
--     total_revenue DECIMAL(20,4) NOT NULL DEFAULT 0,
--     dimensions_json JSON NULL,
--     metrics_json JSON NULL,
--     dimension_hash CHAR(64) NOT NULL,
--     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
--     PRIMARY KEY (id),
--     UNIQUE KEY uq_traffic_acq_row (website_id, report_date, dimension_hash),
--     KEY idx_traffic_acq_date (website_id, report_date),
--     KEY idx_traffic_acq_filter (website_id, filter_name),
--     KEY idx_traffic_acq_source (website_id, session_source, session_medium),
--     KEY idx_traffic_acq_channel (website_id, session_default_channel_group),
--     CONSTRAINT fk_traffic_acq_website FOREIGN KEY (website_id)
--         REFERENCES website_credentials(website_id) ON DELETE CASCADE
-- ) ENGINE=InnoDB;
CREATE TABLE acquisition_report_data (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    website_id BIGINT UNSIGNED NOT NULL,
    report_date DATE NOT NULL,

    report_type ENUM(
        'user_acquisition',
        'traffic_acquisition'
    ) NOT NULL,

    dimension_type ENUM(
        'default_channel_group',
        'source_medium'
    ) NOT NULL,

    dimension_value VARCHAR(512) NOT NULL,

    sessions BIGINT UNSIGNED NOT NULL DEFAULT 0,
    engaged_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0,

    metrics_json JSON NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    UNIQUE KEY uq_acquisition_dimension (
        website_id,
        report_date,
        report_type,
        dimension_type,
        dimension_value
    ),

    KEY idx_acquisition_date (
        website_id,
        report_date,
        report_type,
        dimension_type
    )
);

CREATE TABLE sync_jobs (
    job_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    website_id BIGINT UNSIGNED NOT NULL,
    source ENUM('ga4','gsc') NOT NULL,
    report_type ENUM('website_summary','user_acquisition','traffic_acquisition','search_console') NOT NULL,
    sync_type ENUM('historical','incremental','manual') NOT NULL DEFAULT 'incremental',
    status ENUM('queued','running','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
    requested_start_date DATE NULL,
    requested_end_date DATE NULL,
    last_successful_date DATE NULL,
    rows_fetched BIGINT UNSIGNED NOT NULL DEFAULT 0,
    rows_inserted BIGINT UNSIGNED NOT NULL DEFAULT 0,
    rows_updated BIGINT UNSIGNED NOT NULL DEFAULT 0,
    attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
    error_message TEXT NULL,
    started_at DATETIME NULL,
    completed_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (job_id),
    KEY idx_sync_website_status (website_id, status, created_at),
    KEY idx_sync_source_report (website_id, source, report_type, created_at),
    CONSTRAINT fk_sync_job_website FOREIGN KEY (website_id)
        REFERENCES website_credentials(website_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE sync_checkpoints (
    checkpoint_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    website_id BIGINT UNSIGNED NOT NULL,
    source ENUM('ga4','gsc') NOT NULL,
    report_type ENUM('website_summary','user_acquisition','traffic_acquisition','search_console') NOT NULL,
    last_successful_date DATE NULL,
    last_sync_started_at DATETIME NULL,
    last_sync_completed_at DATETIME NULL,
    status ENUM('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (checkpoint_id),
    UNIQUE KEY uq_sync_checkpoint (website_id, source, report_type),
    CONSTRAINT fk_sync_checkpoint_website FOREIGN KEY (website_id)
        REFERENCES website_credentials(website_id) ON DELETE CASCADE
) ENGINE=InnoDB;
