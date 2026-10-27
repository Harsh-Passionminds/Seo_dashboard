CREATE TABLE IF NOT EXISTS ga4_traffic_acquisition_data (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    website_id BIGINT UNSIGNED NOT NULL,
    report_date DATE NOT NULL,
    dimension_type ENUM('default_channel_group', 'source_medium') NOT NULL,
    dimension_value VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    session_default_channel_group VARCHAR(512) NULL,
    session_source_medium VARCHAR(512) NULL,
    sessions BIGINT UNSIGNED NOT NULL DEFAULT 0,
    engaged_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ga4_traffic_dimension (
        website_id,
        report_date,
        dimension_type,
        dimension_value
    ),
    KEY idx_ga4_traffic_user_date (
        user_id,
        website_id,
        dimension_type,
        report_date
    ),
    CONSTRAINT fk_ga4_traffic_website_owner
        FOREIGN KEY (website_id, user_id)
        REFERENCES website_credentials (website_id, owner_user_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO ga4_traffic_acquisition_data (
    user_id,
    website_id,
    report_date,
    dimension_type,
    dimension_value,
    session_default_channel_group,
    session_source_medium,
    sessions,
    engaged_sessions,
    created_at,
    updated_at
)
SELECT
    legacy.user_id,
    legacy.website_id,
    legacy.report_date,
    CASE legacy.dimension_name
        WHEN 'sessionDefaultChannelGroup' THEN 'default_channel_group'
        WHEN 'sessionSourceMedium' THEN 'source_medium'
    END,
    legacy.dimension_value,
    CASE
        WHEN legacy.dimension_name = 'sessionDefaultChannelGroup'
        THEN legacy.dimension_value
        ELSE NULL
    END,
    CASE
        WHEN legacy.dimension_name = 'sessionSourceMedium'
        THEN legacy.dimension_value
        ELSE NULL
    END,
    CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(legacy.metrics_json, '$.sessions')), '0') AS UNSIGNED),
    CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(legacy.metrics_json, '$.engagedSessions')), '0') AS UNSIGNED),
    legacy.created_at,
    legacy.updated_at
FROM traffic_acquisition_data AS legacy
WHERE legacy.dimension_name IN ('sessionDefaultChannelGroup', 'sessionSourceMedium')
ON DUPLICATE KEY UPDATE
    session_default_channel_group = VALUES(session_default_channel_group),
    session_source_medium = VALUES(session_source_medium),
    sessions = VALUES(sessions),
    engaged_sessions = VALUES(engaged_sessions),
    updated_at = VALUES(updated_at);
