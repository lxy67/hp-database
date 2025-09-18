const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

async function setupDatabase() {
    try {
        console.log('Connecting to database...');

        // Use individual environment variables for database connection
        const dbConfig = {
            user: process.env.POSTGRES_USERNAME || 'root',
            host: process.env.POSTGRES_HOST || process.env.HP_DATABASE_HOST,
            database: process.env.POSTGRES_DATABASE || 'zeabur',
            password: process.env.POSTGRES_PASSWORD,
            port: process.env.POSTGRES_PORT || 5432,
            ssl: {
                rejectUnauthorized: false,
                sslmode: 'require'
            }
        };

        console.log('Connecting to database with config:', {
            ...dbConfig,
            password: '***', // Hide password in logs
            host: dbConfig.host // Log the host for debugging
        });

        const pool = new Pool(dbConfig);

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
