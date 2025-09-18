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

        console.log('Using connection string:', connectionString.replace(/:([^:]+)@/, ':***@')); // Hide password in logs

        const pool = new Pool({
            connectionString,
            ssl: {
                rejectUnauthorized: false,
                sslmode: 'require'
            }
        });

        // Test the connection
        await pool.query('SELECT NOW()');
        console.log('✅ Successfully connected to the database');

        // Read and execute the SQL file
        console.log('Reading database.sql...');
        const sql = await fs.readFile(path.join(__dirname, 'database.sql'), 'utf8');
        
        console.log('Executing SQL commands...');
        await pool.query(sql);

        console.log('✅ Database setup completed successfully!');
    } catch (error) {
        console.error('❌ Database setup failed:', error.message);
        if (error.code) console.error('Error code:', error.code);
        if (error.position) console.error('Error position:', error.position);
        process.exit(1);
    } finally {
        // Close the pool
        if (pool) await pool.end();
        process.exit(0);
    }
}

// Run the setup
setupDatabase();
