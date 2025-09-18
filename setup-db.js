const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

async function setupDatabase() {
  try {
    console.log('Connecting to database...');
    
    // Use POSTGRES_URI if available, otherwise fall back to DATABASE_URL
    const connectionString = process.env.POSTGRES_URI || process.env.DATABASE_URL;
    
    if (!connectionString) {
      throw new Error('No database connection string provided. Please set POSTGRES_URI or DATABASE_URL environment variable.');
    }

    const pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' 
        ? { rejectUnauthorized: false } // Required for Zeabur's PostgreSQL
        : false, // Disable SSL for local development if needed
    });

    // Read the SQL file
    const sql = await fs.readFile(path.join(__dirname, 'database.sql'), 'utf8');
    
    // Execute the SQL commands
    await pool.query(sql);
    
    console.log('Database setup completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Unhandled error during database setup:', error);
    process.exit(1);
  }
}

// Run the setup
setupDatabase();
