-- Create strains table
CREATE TABLE IF NOT EXISTS strains (
    id SERIAL PRIMARY KEY,
    strain TEXT NOT NULL,
    gene_seq TEXT NOT NULL,
    raw_country TEXT,
    region TEXT,
    host_disease TEXT,
    drug_resistance TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for search performance
CREATE INDEX IF NOT EXISTS idx_strains_strain ON strains(strain);
CREATE INDEX IF NOT EXISTS idx_strains_raw_country ON strains(raw_country);
CREATE INDEX IF NOT EXISTS idx_strains_region ON strains(region);
CREATE INDEX IF NOT EXISTS idx_strains_host_disease ON strains(host_disease);
CREATE INDEX IF NOT EXISTS idx_strains_drug_resistance ON strains(drug_resistance);

-- Create a materialized view for distinct values (for search filters)
CREATE MATERIALIZED VIEW IF NOT EXISTS filter_values AS
SELECT 
    'raw_country' AS filter_type,
    raw_country AS value,
    COUNT(*) AS count
FROM strains
WHERE raw_country IS NOT NULL
GROUP BY raw_country
UNION ALL
SELECT 
    'region' AS filter_type,
    region AS value,
    COUNT(*) AS count
FROM strains
WHERE region IS NOT NULL
GROUP BY region
UNION ALL
SELECT 
    'host_disease' AS filter_type,
    host_disease AS value,
    COUNT(*) AS count
FROM strains
WHERE host_disease IS NOT NULL
GROUP BY host_disease
UNION ALL
SELECT 
    'drug_resistance' AS filter_type,
    drug_resistance AS value,
    COUNT(*) AS count
FROM strains
WHERE drug_resistance IS NOT NULL
GROUP BY drug_resistance;

-- Create index on materialized view for faster lookups
CREATE INDEX IF NOT EXISTS idx_filter_values_type_value ON filter_values(filter_type, value);

-- Function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_filter_values()
RETURNS TRIGGER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY filter_values;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to refresh materialized view when strains table is updated
DROP TRIGGER IF EXISTS refresh_filter_values_trigger ON strains;
CREATE TRIGGER refresh_filter_values_trigger
AFTER INSERT OR UPDATE OR DELETE ON strains
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_filter_values();
