const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

async function setupDatabase() {
    console.log('Connecting to database...');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { 
            rejectUnauthorized: false 
        } : false
    });

    const client = await pool.connect();
    
    try {
        console.log('Starting database setup...');
        
        // Begin a transaction
        await client.query('BEGIN');
        
        // Read the SQL file
        const sqlFilePath = path.join(__dirname, 'database.sql');
        console.log(`Reading SQL file from: ${sqlFilePath}`);
        
        const sql = await fs.readFile(sqlFilePath, 'utf8');
        
        // Split the SQL file into individual commands
        const commands = sql.split(';').filter(cmd => cmd.trim() !== '');
        
        // Execute each command
        console.log(`Found ${commands.length} SQL commands to execute...`);
        for (const [index, command] of commands.entries()) {
            try {
                if (command.trim() === '') continue;
                console.log(`Executing command ${index + 1}/${commands.length}...`);
                await client.query(command);
            } catch (error) {
                console.error(`Error executing command ${index + 1}:`, error.message);
                throw error;
            }
        }
        
        // Commit the transaction
        await client.query('COMMIT');
        console.log('✅ Database setup completed successfully!');
        
    } catch (error) {
        // Rollback the transaction in case of error
        await client.query('ROLLBACK');
        console.error('❌ Error setting up database:', error.message);
        if (error.position) {
            const position = parseInt(error.position);
            const start = Math.max(0, position - 50);
            const end = Math.min(position + 50, error.query.length);
            console.error('Error context:', error.query.substring(start, end));
            console.error(' '.repeat(Math.min(50, position - start)) + '^');
        }
        process.exit(1);
    } finally {
        // Release the client back to the pool
        client.release();
        await pool.end();
        process.exit(0);
    }
}

// Run the setup
setupDatabase().catch(error => {
    console.error('Unhandled error during database setup:', error);
    process.exit(1);
});
