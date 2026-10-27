ALTER TABLE website_credentials
    ADD UNIQUE KEY uq_website_id_owner (website_id, owner_user_id);

CREATE TABLE user_acquisition_data (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    website_id BIGINT UNSIGNED NOT NULL,
    report_date DATE NOT NULL,
    dimension_name VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    dimension_value VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    metrics_json JSON NOT NULL,
    dimensions_json JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_user_acquisition (
        website_id,
        report_date,
        dimension_name,
        dimension_value
    ),
    KEY idx_user_acquisition_owner_date (
        user_id,
        website_id,
        report_date
    ),
    KEY idx_user_acquisition_website_owner (
        website_id,
        user_id
    ),
    CONSTRAINT fk_user_acquisition_website_owner
        FOREIGN KEY (website_id, user_id)
        REFERENCES website_credentials (website_id, owner_user_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE traffic_acquisition_data (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    website_id BIGINT UNSIGNED NOT NULL,
    report_date DATE NOT NULL,
    dimension_name VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    dimension_value VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    metrics_json JSON NOT NULL,
    dimensions_json JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_traffic_acquisition (
        website_id,
        report_date,
        dimension_name,
        dimension_value
    ),
    KEY idx_traffic_acquisition_owner_date (
        user_id,
        website_id,
        report_date
    ),
    KEY idx_traffic_acquisition_website_owner (
        website_id,
        user_id
    ),
    CONSTRAINT fk_traffic_acquisition_website_owner
        FOREIGN KEY (website_id, user_id)
        REFERENCES website_credentials (website_id, owner_user_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
