CREATE TABLE tracked_keywords (
    keyword_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    website_id BIGINT UNSIGNED NOT NULL,
    keyword VARCHAR(500) NOT NULL,
    keyword_normalized VARCHAR(500) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (keyword_id),
    UNIQUE KEY uq_tracked_keyword_website (website_id, keyword_normalized),
    KEY idx_tracked_keywords_website (website_id),
    CONSTRAINT fk_tracked_keywords_website
        FOREIGN KEY (website_id) REFERENCES website_credentials(website_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE gsc_keyword_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    website_id BIGINT UNSIGNED NOT NULL,
    keyword_id BIGINT UNSIGNED NOT NULL,
    report_date DATE NOT NULL,
    clicks BIGINT UNSIGNED NOT NULL DEFAULT 0,
    impressions BIGINT UNSIGNED NOT NULL DEFAULT 0,
    ctr DECIMAL(12,10) NOT NULL DEFAULT 0,
    average_position DECIMAL(12,4) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_gsc_keyword_history (website_id, keyword_id, report_date),
    KEY idx_gsc_keyword_history_date (keyword_id, report_date),
    KEY idx_gsc_keyword_history_website (website_id, report_date),
    CONSTRAINT fk_gsc_keyword_history_keyword
        FOREIGN KEY (keyword_id) REFERENCES tracked_keywords(keyword_id) ON DELETE CASCADE,
    CONSTRAINT fk_gsc_keyword_history_website
        FOREIGN KEY (website_id) REFERENCES website_credentials(website_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
