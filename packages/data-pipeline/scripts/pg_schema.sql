-- Electoral Rolls PostgreSQL Schema
-- Optimized for high-throughput concurrent ingestion

CREATE TABLE IF NOT EXISTS voters (
    id BIGSERIAL PRIMARY KEY,
    pdf_file TEXT NOT NULL,
    district TEXT,
    ac_num INTEGER,
    part_num INTEGER,
    page_num INTEGER,
    serial_no INTEGER,
    house_no TEXT,
    voter_name_kn TEXT,
    voter_name_en TEXT,
    relative_name_kn TEXT,
    relative_name_en TEXT,
    relation_type TEXT,
    gender TEXT,
    age INTEGER,
    voter_id TEXT,
    name_origin TEXT DEFAULT '',
    search_tokens JSONB,
    confidence REAL,
    data_quality INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_voters_pdf ON voters(pdf_file);
CREATE INDEX IF NOT EXISTS idx_voters_district_ac_part ON voters(district, ac_num, part_num);
CREATE INDEX IF NOT EXISTS idx_voters_name_en ON voters(voter_name_en);
CREATE INDEX IF NOT EXISTS idx_voters_voter_id ON voters(voter_id);
