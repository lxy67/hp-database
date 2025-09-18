const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function setupDatabase() {
    console.log('Starting database setup...');
    console.log('DATABASE_URL:', process.env.DATABASE_URL ? '*** (hidden for security) ***' : 'Not set');

    if (!process.env.DATABASE_URL) {
        console.error('❌ Error: DATABASE_URL environment variable is not set');
        process.exit(1);
    }

    const config = {
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false,
            sslmode: 'require'
        },
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
    };

    const client = new Client(config);

    try {
        console.log('Connecting to database...');
        await client.connect();
        console.log('✅ Successfully connected to database');

        // Check if tables already exist
        try {
            const checkTable = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'strains'
                )
            `);
            
            if (checkTable.rows[0].exists) {
                console.log('✅ Database tables already exist, skipping initialization');
                return;
            }
        } catch (err) {
            console.log('No existing tables found, proceeding with initialization...');
        }

        console.log('Reading SQL file...');
        const sqlPath = path.join(__dirname, 'database.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        // Split SQL into individual commands and filter out empty ones
        const commands = sql
            .split(';')
            .map(cmd => cmd.trim())
            .filter(cmd => cmd.length > 0);

        console.log(`Found ${commands.length} SQL commands to execute`);

        // Execute commands in a transaction
        await client.query('BEGIN');
        
        try {
            for (let i = 0; i < commands.length; i++) {
                const command = commands[i];
                try {
                    console.log(`Executing command ${i + 1}/${commands.length}...`);
                    await client.query(command);
                } catch (err) {
                    console.error(`❌ Error in command ${i + 1}:`, err.message);
                    console.error('Failed command:', command.substring(0, 100) + '...');
                    throw err;
                }
            }
            await client.query('COMMIT');
            console.log('✅ Database setup completed successfully');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }

    } catch (err) {
        console.error('❌ Database setup failed:');
        console.error('Error:', err.message);
        if (err.code) console.error('Error code:', err.code);
        if (err.position) console.error('Error position:', err.position);
        process.exit(1);
    } finally {
        try {
            await client.end();
            console.log('Database connection closed');
        } catch (err) {
            console.error('Error closing database connection:', err.message);
        }
    }
}

// Execute the setup
setupDatabase().catch(err => {
    console.error('Unhandled error during setup:', err);
    process.exit(1);
});
