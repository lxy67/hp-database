-- Enable pg_trgm extension for faster text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Drop existing tables if they exist
DROP TABLE IF EXISTS strains CASCADE;
DROP TABLE IF EXISTS countries CASCADE;
DROP TABLE IF EXISTS regions CASCADE;
DROP TABLE IF EXISTS diseases CASCADE;
DROP TABLE IF EXISTS drug_resistances CASCADE;

-- Create tables with appropriate data types
CREATE TABLE countries (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE regions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    country_id INTEGER REFERENCES countries(id),
    UNIQUE(name, country_id)
);

CREATE TABLE diseases (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE drug_resistances (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE
);

-- Main strains table with proper indexing
CREATE TABLE strains (
    id BIGSERIAL PRIMARY KEY,
    strain_id VARCHAR(255) NOT NULL,
    gene_seq TEXT NOT NULL,
    country_id INTEGER REFERENCES countries(id),
    region_id INTEGER REFERENCES regions(id),
    disease_id INTEGER REFERENCES diseases(id),
    drug_resistance_id INTEGER REFERENCES drug_resistances(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_strain UNIQUE (strain_id)
);

-- Create indexes for faster searching
CREATE INDEX idx_strain_id ON strains(strain_id);
CREATE INDEX idx_gene_seq_trgm ON strains USING gin (gene_seq gin_trgm_ops);
CREATE INDEX idx_country ON strains(country_id);
CREATE INDEX idx_region ON strains(region_id);
CREATE INDEX idx_disease ON strains(disease_id);
CREATE INDEX idx_drug_resistance ON strains(drug_resistance_id);

-- Create a materialized view for filter values
CREATE MATERIALIZED VIEW filter_values AS
SELECT 
    (SELECT json_agg(DISTINCT name ORDER BY name) FROM countries) AS countries,
    (SELECT json_agg(DISTINCT name ORDER BY name) FROM regions) AS regions,
    (SELECT json_agg(DISTINCT name ORDER BY name) FROM diseases) AS diseases,
    (SELECT json_agg(DISTINCT name ORDER BY name) FROM drug_resistances) AS drug_resistances;

-- Create a function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_filter_values()
RETURNS TRIGGER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW filter_values;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create triggers to refresh the materialized view when data changes
CREATE TRIGGER refresh_filter_values_trigger
AFTER INSERT OR UPDATE OR DELETE ON countries
FOR EACH STATEMENT EXECUTE FUNCTION refresh_filter_values();

CREATE TRIGGER refresh_filter_values_trigger
AFTER INSERT OR UPDATE OR DELETE ON regions
FOR EACH STATEMENT EXECUTE FUNCTION refresh_filter_values();

CREATE TRIGGER refresh_filter_values_trigger
AFTER INSERT OR UPDATE OR DELETE ON diseases
FOR EACH STATEMENT EXECUTE FUNCTION refresh_filter_values();

CREATE TRIGGER refresh_filter_values_trigger
AFTER INSERT OR UPDATE OR DELETE ON drug_resistances
FOR EACH STATEMENT EXECUTE FUNCTION refresh_filter_values();
