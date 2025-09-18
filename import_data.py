import datetime
import os
import psycopg2
from psycopg2 import sql
import pandas as pd
from dotenv import load_dotenv
import logging
from typing import Dict, List, Optional, Any
from psycopg2.extras import execute_batch

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def get_db_connection():
    """Create a connection to the PostgreSQL database."""
    try:
        conn = psycopg2.connect(
            dbname=os.getenv('DB_NAME', 'hpdata'),
            user=os.getenv('DB_USER', 'postgres'),
            password=os.getenv('DB_PASSWORD', '123456'),
            host=os.getenv('DB_HOST', '127.0.0.1'),
            port=os.getenv('DB_PORT', '5432')
        )
        conn.autocommit = False
        return conn
    except Exception as e:
        logging.error(f"Error connecting to the database: {e}")
        raise

def get_or_create_id(conn, table: str, name: str, extra_cols: Optional[Dict] = None) -> int:
    """Get or create a record in the specified table and return its ID."""
    if not name or (isinstance(name, float) and pd.isna(name)):
        return None
        
    with conn.cursor() as cur:
        # Check if record exists
        query = sql.SQL("SELECT id FROM {} WHERE name = %s").format(sql.Identifier(table))
        cur.execute(query, (name,))
        result = cur.fetchone()
        
        if result:
            return result[0]
            
        # If not exists, insert new record
        columns = ['name']
        values = [name]
        placeholders = ['%s']
        
        if extra_cols:
            for col, val in extra_cols.items():
                columns.append(col)
                values.append(val)
                placeholders.append('%s')
        
        query = sql.SQL("INSERT INTO {} ({}) VALUES ({}) RETURNING id").format(
            sql.Identifier(table),
            sql.SQL(', ').join(map(sql.Identifier, columns)),
            sql.SQL(', ').join(sql.Placeholder() * len(columns))
        )
        
        cur.execute(query, values)
        return cur.fetchone()[0]

def ensure_tables_exist(conn):
    """Ensure all required tables exist in the database."""
    with conn.cursor() as cur:
        # Check if countries table exists
        cur.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'countries'
            );
        """)
        if not cur.fetchone()[0]:
            logging.error("Required database tables do not exist. Please run init_db.sql first.")
            raise Exception("Database tables not initialized. Run init_db.sql first.")

def import_csv_to_db(csv_file_path: str, batch_size: int = 100) -> None:
    """Import data from CSV file to PostgreSQL database."""
    if not os.path.exists(csv_file_path):
        logging.error(f"CSV file not found: {csv_file_path}")
        return
    
    conn = None
    try:
        # Read CSV file
        logging.info(f"Reading CSV file: {csv_file_path}")
        df = pd.read_csv(csv_file_path, dtype=str)
        df = df.where(pd.notnull(df), None)  # Convert NaN to None
        
        # Keep only required columns
        required_columns = ['strain', 'gene_seq', 'raw_country', 'region', 'host_disease', 'Drug_resistance']
        df = df[required_columns]
        
        conn = get_db_connection()
        ensure_tables_exist(conn)
        cur = conn.cursor()
        
        # Process data in batches
        total_rows = len(df)
        logging.info(f"Starting import of {total_rows} records")
        
        for i in range(0, total_rows, batch_size):
            batch = df.iloc[i:i + batch_size]
            batch_data = []
            
            for _, row in batch.iterrows():
                try:
                    # Get or create country
                    country_id = get_or_create_id(conn, 'countries', row['raw_country'])
                    
                    # Get or create region (with country_id)
                    region_id = None
                    if row['region']:
                        region_id = get_or_create_id(
                            conn, 
                            'regions', 
                            row['region'],
                            {'country_id': country_id} if country_id else None
                        )
                    
                    # Get or create disease
                    disease_id = get_or_create_id(conn, 'diseases', row['host_disease'])
                    
                    # Get or create drug resistance
                    drug_resistance_id = get_or_create_id(conn, 'drug_resistances', row['Drug_resistance'])
                    
                    # Prepare strain data
                    strain_data = (
                        row['strain'],  # strain_id
                        row['gene_seq'],  # gene_seq
                        country_id,
                        region_id,
                        disease_id,
                        drug_resistance_id
                    )
                    
                    batch_data.append(strain_data)
                    
                except Exception as e:
                    logging.error(f"Error processing row {_}: {e}")
                    conn.rollback()
                    continue
            
            if not batch_data:
                continue
                
            # Insert batch of strains
            try:
                query = """
                INSERT INTO strains 
                (strain_id, gene_seq, country_id, region_id, disease_id, drug_resistance_id)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (strain_id) DO UPDATE SET
                    gene_seq = EXCLUDED.gene_seq,
                    country_id = EXCLUDED.country_id,
                    region_id = EXCLUDED.region_id,
                    disease_id = EXCLUDED.disease_id,
                    drug_resistance_id = EXCLUDED.drug_resistance_id,
                    updated_at = CURRENT_TIMESTAMP
                """
                
                execute_batch(cur, query, batch_data)
                conn.commit()
                logging.info(f"Processed {min(i + len(batch_data), total_rows)}/{total_rows} records")
                
            except Exception as e:
                conn.rollback()
                logging.error(f"Error inserting batch {i//batch_size + 1}: {e}")
                continue
        
        logging.info("Data import completed successfully")
        
    except Exception as e:
        logging.error(f"Error during import: {e}")
        if conn:
            conn.rollback()
    finally:
        if conn:
            conn.close()

def generate_sql(csv_file, output_file='database.sql'):
    """Generate complete SQL file with schema and data."""
    print(f"Reading CSV file: {csv_file}")
    df = pd.read_csv(csv_file, dtype=str)
    df = df.where(pd.notnull(df), None)
    
    # Keep only required columns
    required_columns = ['strain', 'gene_seq', 'raw_country', 'region', 'host_disease', 'Drug_resistance']
    df = df[required_columns]
    
    # Start building SQL
    sql_commands = [
        "-- Generated by import_data.py",
        f"-- Date: {datetime.datetime.now().isoformat()}",
        "\n-- Enable extensions",
        "CREATE EXTENSION IF NOT EXISTS pg_trgm;\n",
        
        "-- Drop existing tables",
        "DROP TABLE IF EXISTS strains CASCADE;",
        "DROP TABLE IF EXISTS countries CASCADE;",
        "DROP TABLE IF EXISTS regions CASCADE;",
        "DROP TABLE IF EXISTS diseases CASCADE;",
        "DROP TABLE IF EXISTS drug_resistances CASCADE;\n",
        
        "-- Create tables",
        "CREATE TABLE countries (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE);",
        "CREATE TABLE regions (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, country_id INTEGER REFERENCES countries(id), UNIQUE(name, country_id));",
        "CREATE TABLE diseases (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE);",
        "CREATE TABLE drug_resistances (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE);",
        """
        CREATE TABLE strains (
            id BIGSERIAL PRIMARY KEY,
            strain_id VARCHAR(255) NOT NULL,
            gene_seq TEXT NOT NULL,
            country_id INTEGER REFERENCES countries(id),
            region_id INTEGER REFERENCES regions(id),
            disease_id INTEGER REFERENCES diseases(id),
            drug_resistance_id INTEGER REFERENCES drug_resistances(id),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT unique_strain UNIQUE (strain_id)
        );
        """,
        
        "-- Create indexes",
        "CREATE INDEX idx_strain_id ON strains(strain_id);",
        "CREATE INDEX idx_gene_seq_trgm ON strains USING gin (gene_seq gin_trgm_ops);",
        "CREATE INDEX idx_country ON strains(country_id);",
        "CREATE INDEX idx_region ON strains(region_id);",
        "CREATE INDEX idx_disease ON strains(disease_id);",
        "CREATE INDEX idx_drug_resistance ON strains(drug_resistance_id);\n"
    ]
    
    # Collect unique values for each table
    unique_values = {
        'countries': set(),
        'regions': set(),  # (region_name, country_name) tuples
        'diseases': set(),
        'drug_resistances': set()
    }
    
    for _, row in df.iterrows():
        if row['raw_country']:
            unique_values['countries'].add(row['raw_country'])
            if row['region']:
                unique_values['regions'].add((row['region'], row['raw_country']))
        if row['host_disease']:
            unique_values['diseases'].add(row['host_disease'])
        if row['Drug_resistance']:
            unique_values['drug_resistances'].add(row['Drug_resistance'])
    
    # Insert unique values
    sql_commands.append("-- Insert countries")
    for country in unique_values['countries']:
        sql_commands.append(f"INSERT INTO countries (name) VALUES ('{escape_sql(country)}') ON CONFLICT (name) DO NOTHING;")
    
    sql_commands.append("\n-- Insert regions")
    for region, country in unique_values['regions']:
        sql_commands.append(f"""
        DO $$
        DECLARE
            cid INTEGER;
            rid INTEGER;
        BEGIN
            SELECT id INTO cid FROM countries WHERE name = '{escape_sql(country)}';
            IF FOUND THEN
                INSERT INTO regions (name, country_id) 
                VALUES ('{escape_sql(region)}', cid)
                ON CONFLICT (name, country_id) DO NOTHING
                RETURNING id INTO rid;
            END IF;
        END $$;
        """)
    
    sql_commands.append("\n-- Insert diseases")
    for disease in unique_values['diseases']:
        sql_commands.append(f"INSERT INTO diseases (name) VALUES ('{escape_sql(disease)}') ON CONFLICT (name) DO NOTHING;")
    
    sql_commands.append("\n-- Insert drug resistances")
    for dr in unique_values['drug_resistances']:
        sql_commands.append(f"INSERT INTO drug_resistances (name) VALUES ('{escape_sql(dr)}') ON CONFLICT (name) DO NOTHING;")
    
    # Insert strains
    sql_commands.append("\n-- Insert strains")
    for _, row in df.iterrows():
        if not row['strain'] or not row['gene_seq']:
            continue
            
        sql = """
        DO $$
        DECLARE
            cid INTEGER;
            rid INTEGER;
            did INTEGER;
            drid INTEGER;
            sid BIGINT;
        BEGIN
            -- Get country ID
            SELECT id INTO cid FROM countries WHERE name = '{}';
            
            -- Get region ID if exists
            IF '{}' != '' THEN
                SELECT r.id INTO rid 
                FROM regions r 
                JOIN countries c ON r.country_id = c.id 
                WHERE r.name = '{}' AND c.name = '{}';
            END IF;
            
            -- Get disease ID
            SELECT id INTO did FROM diseases WHERE name = '{}';
            
            -- Get drug resistance ID
            SELECT id INTO drid FROM drug_resistances WHERE name = '{}';
            
            -- Insert strain
            INSERT INTO strains (strain_id, gene_seq, country_id, region_id, disease_id, drug_resistance_id)
            VALUES ('{}', '{}', cid, rid, did, drid)
            ON CONFLICT (strain_id) DO UPDATE SET
                gene_seq = EXCLUDED.gene_seq,
                country_id = EXCLUDED.country_id,
                region_id = EXCLUDED.region_id,
                disease_id = EXCLUDED.disease_id,
                drug_resistance_id = EXCLUDED.drug_resistance_id
            RETURNING id INTO sid;
        END $$;
        """.format(
            escape_sql(row['raw_country']),
            escape_sql(row['region'] or ''),
            escape_sql(row['region'] or ''),
            escape_sql(row['raw_country'] or ''),
            escape_sql(row['host_disease'] or ''),
            escape_sql(row['Drug_resistance'] or ''),
            escape_sql(row['strain']),
            escape_sql(row['gene_seq'])
        )
        sql_commands.append(sql)
    
    # Create materialized view for filters
    sql_commands.append("""
    -- Create materialized view for filters
    DROP MATERIALIZED VIEW IF EXISTS filter_values;
    CREATE MATERIALIZED VIEW filter_values AS
    SELECT 
        (SELECT json_agg(DISTINCT name ORDER BY name) FROM countries) AS countries,
        (SELECT json_agg(DISTINCT name ORDER BY name) FROM regions) AS regions,
        (SELECT json_agg(DISTINCT name ORDER BY name) FROM diseases) AS diseases,
        (SELECT json_agg(DISTINCT name ORDER BY name) FROM drug_resistances) AS drug_resistances;
    """)
    
    # Write to file
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write('\n'.join(sql_commands))
    
    print(f"SQL file generated: {output_file}")

def escape_sql(value):
    """Escape special characters for SQL."""
    if pd.isna(value) or value is None:
        return 'NULL'
    return str(value).replace("'", "''")

def main():
    """Main function to run the script."""
    load_dotenv()
    
    # Input file
    csv_file = 'merged_final_results123_top101.csv'
    
    if not os.path.exists(csv_file):
        logging.error(f"CSV file not found: {csv_file}")
        return
    
    # Start import
    import_csv_to_db(csv_file)
    generate_sql(csv_file)

if __name__ == "__main__":
    main()
