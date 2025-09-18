const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

// Initialize Express app
const app = express();

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Database configuration
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.query('SELECT NOW()', (err) => {
    if (err) {
        console.error('Database connection error', err.stack);
    } else {
        console.log('Successfully connected to PostgreSQL database');
    }
});

// Get filter options
app.get('/api/filters', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM filter_values LIMIT 1');
        res.json(result.rows[0] || {});
    } catch (err) {
        console.error('Error fetching filters:', err);
        res.status(500).json({ error: 'Failed to fetch filter values' });
    }
});

// Search endpoint with pagination and filters
app.get('/api/strains/search', async (req, res) => {
    try {
        const {
            query = '',
            country,
            region,
            disease,
            drugResistance,
            page = 1,
            limit = 10
        } = req.query;

        const offset = (page - 1) * limit;
        
        let searchQuery = `
            SELECT 
                s.id, 
                s.strain_id,
                s.gene_seq,
                c.name as country,
                r.name as region,
                d.name as disease,
                dr.name as drug_resistance
            FROM strains s
            LEFT JOIN countries c ON s.country_id = c.id
            LEFT JOIN regions r ON s.region_id = r.id
            LEFT JOIN diseases d ON s.disease_id = d.id
            LEFT JOIN drug_resistances dr ON s.drug_resistance_id = dr.id
            WHERE 1=1
        `;

        const queryParams = [];
        let paramCount = 1;

        if (query) {
            searchQuery += ` AND (s.strain_id ILIKE $${paramCount} OR s.gene_seq ILIKE $${paramCount})`;
            queryParams.push(`%${query}%`);
            paramCount++;
        }

        if (country) {
            searchQuery += ` AND c.name = $${paramCount}`;
            queryParams.push(country);
            paramCount++;
        }

        if (region) {
            searchQuery += ` AND r.name = $${paramCount}`;
            queryParams.push(region);
            paramCount++;
        }

        if (disease) {
            searchQuery += ` AND d.name = $${paramCount}`;
            queryParams.push(disease);
            paramCount++;
        }

        if (drugResistance) {
            searchQuery += ` AND dr.name = $${paramCount}`;
            queryParams.push(drugResistance);
        }

        // Add pagination
        searchQuery += ` ORDER BY s.id LIMIT $${paramCount + 1} OFFSET $${paramCount}`;
        queryParams.push(parseInt(limit), offset);

        const result = await pool.query(searchQuery, queryParams);
        res.json(result.rows);
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Export data endpoint
app.get('/api/strains/export', async (req, res) => {
    try {
        const query = `
            SELECT 
                s.strain_id,
                s.gene_seq,
                c.name as country,
                r.name as region,
                d.name as disease,
                dr.name as drug_resistance
            FROM strains s
            LEFT JOIN countries c ON s.country_id = c.id
            LEFT JOIN regions r ON s.region_id = r.id
            LEFT JOIN diseases d ON s.disease_id = d.id
            LEFT JOIN drug_resistances dr ON s.drug_resistance_id = dr.id
        `;
        
        const result = await pool.query(query);
        
        // Set headers for file download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=strains_export.csv');
        
        // Convert to CSV
        const header = Object.keys(result.rows[0] || {}).join(',') + '\n';
        const csv = result.rows.map(row => 
            Object.values(row).map(field => 
                `"${String(field || '').replace(/"/g, '""')}"`
            ).join(',')
        ).join('\n');
        
        res.send(header + csv);
    } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({ error: 'Export failed' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app; // For testing
