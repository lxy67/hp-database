import os
import csv
import psycopg2
from psycopg2 import sql
from dotenv import load_dotenv
import pandas as pd
import logging
from typing import List, Dict, Any

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def get_db_connection():
    """Create a connection to the PostgreSQL database."""
    try:
        conn = psycopg2.connect(
            host=os.getenv('DB_HOST', 'localhost'),
            database=os.getenv('DB_NAME', 'hpdata'),
            user=os.getenv('DB_USER', 'postgres'),
            password=os.getenv('DB_PASSWORD', '123456'),
            port=os.getenv('DB_PORT', '5432')
        )
        return conn
    except Exception as e:
        logging.error(f"Error connecting to the database: {e}")
        raise

def import_csv_to_db(csv_file_path):
    """Import data from CSV file to PostgreSQL database."""
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Count existing records
        cur.execute("SELECT COUNT(*) FROM strains")
        count_before = cur.fetchone()[0]
        print(f"Records before import: {count_before}")
        
        # Read and process the CSV file
        with open(csv_file_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            
            # Batch insert for better performance
            batch_size = 100
            batch = []
            
            for row in reader:
                # Extract required columns
                strain_data = {
                    'strain': row.get('strain', ''),
                    'gene_seq': row.get('gene_seq', ''),
                    'raw_country': row.get('raw_country'),
                    'region': row.get('region'),
                    'host_disease': row.get('host_disease'),
                    'drug_resistance': row.get('Drug_resistance')
                }
                
                # Add to batch
                batch.append(strain_data)
                
                # Execute batch insert when batch size is reached
                if len(batch) >= batch_size:
                    execute_batch_insert(cur, batch)
                    batch = []
            
            # Insert any remaining records
            if batch:
                execute_batch_insert(cur, batch)
        
        # Count records after import
        cur.execute("SELECT COUNT(*) FROM strains")
        count_after = cur.fetchone()[0]
        print(f"Records after import: {count_after}")
        print(f"Successfully imported {count_after - count_before} records")
        
        # Commit the transaction
        conn.commit()
        
    except Exception as e:
        print(f"Error: {e}")
        if conn:
            conn.rollback()
    finally:
        if conn:
            conn.close()

def execute_batch_insert(cur, batch):
    """Execute a batch insert of strain records."""
    if not batch:
        return
        
    # Prepare the SQL query
    query = """
        INSERT INTO strains 
            (strain, gene_seq, raw_country, region, host_disease, drug_resistance)
        VALUES 
            (%(strain)s, %(gene_seq)s, %(raw_country)s, 
             %(region)s, %(host_disease)s, %(drug_resistance)s)
        ON CONFLICT (strain) DO NOTHING
    """
    
    # Execute the batch insert
    cur.executemany(query, batch)
    print(f"Inserted/updated {len(batch)} records")

def generate_complete_sql(csv_file: str, output_sql: str = 'database.sql') -> None:
    """
    Generate a complete SQL file with both schema and data.
    
    Args:
        csv_file: Path to the CSV file containing the data
        output_sql: Path where to save the generated SQL file
    """
    try:
        # Read the schema from init_db.sql
        with open('init_db.sql', 'r', encoding='utf-8') as f:
            schema_sql = f.read()
        
        # Read CSV data
        df = pd.read_csv(csv_file)
        
        # Replace NaN with None for proper NULL handling
        df = df.where(pd.notnull(df), None)
        
        with open(output_sql, 'w', encoding='utf-8') as f:
            # Write schema
            f.write("-- =============================================\n")
            f.write("-- Database Schema\n")
            f.write("-- =============================================\n\n")
            f.write(schema_sql)
            
            # Write data
            f.write("\n-- =============================================\n")
            f.write("-- Sample Data\n")
            f.write("-- =============================================\n\n")
            f.write("SET session_replication_role = 'replica';  -- Disable triggers and constraints\n\n")
            
            for _, row in df.iterrows():
                # Prepare column names and values
                columns = [f'"{col}"' for col in df.columns]
                placeholders = []
                values = []
                
                for val in row:
                    if pd.isna(val) or val is None:
                        placeholders.append('NULL')
                    elif isinstance(val, (int, float)):
                        placeholders.append(str(val))
                    else:
                        # Escape single quotes in string values
                        val_str = str(val).replace("'", "''")
                        placeholders.append(f"'{val_str}'")
                
                # Build the INSERT statement
                insert_sql = f"""
                INSERT INTO strains ({', '.join(columns)})
                VALUES ({', '.join(placeholders)});
                """
                f.write(insert_sql)
            
            f.write("\nSET session_replication_role = 'origin';  -- Re-enable triggers and constraints\n")
            
            # Create indexes after data import for better performance
            f.write("""
            -- =============================================
            -- Create Indexes
            -- =============================================
            
            CREATE INDEX IF NOT EXISTS idx_strain ON public.strains USING btree (strain);
            CREATE INDEX IF NOT EXISTS idx_country ON public.strains USING btree (raw_country);
            CREATE INDEX IF NOT EXISTS idx_region ON public.strains USING btree (region);
            CREATE INDEX IF NOT EXISTS idx_disease ON public.strains USING btree (host_disease);
            CREATE INDEX IF NOT EXISTS idx_drug_resistance ON public.strains USING btree ("Drug_resistance");
            
            -- Refresh materialized view
            REFRESH MATERIALIZED VIEW filter_values;
            """)
        
        logging.info(f"Successfully generated {output_sql} with schema and data")
        return output_sql
        
    except Exception as e:
        logging.error(f"Error generating SQL file: {e}")
        raise

def main():
    """Main function to run the script."""
    load_dotenv()
    
    # Input and output files
    csv_file = 'merged_final_results123_top101.csv'
    output_sql = 'database.sql'
    
    # Generate the complete SQL file
    try:
        sql_file = generate_complete_sql(csv_file, output_sql)
        print(f"\n✅ Successfully generated {sql_file}")
        print("\nNext steps:")
        print(f"1. Upload {sql_file} to your server")
        print("2. Import it using: psql -U username -d dbname -f database.sql")
        print("3. Deploy your application")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return 1
    
    # Import CSV to database
    if os.path.exists(csv_file):
        print(f"Starting import from {csv_file}...")
        import_csv_to_db(csv_file)
        print("Import completed.")
    else:
        print(f"Error: File '{csv_file}' not found.")
        print("Please make sure the CSV file exists in the same directory as this script.")
    
    return 0

if __name__ == "__main__":
    main()
