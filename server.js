const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const path = require('path');

// Initialize Express app
const app = express();

// Trust first proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

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

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Database configuration
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
        sslmode: 'require'
    }
});

let retryCount = 0;
const maxRetries = 3;

async function initializeDatabase() {
    try {
        await pool.query('SELECT NOW()');
        console.log('✅ 数据库连接成功');
    } catch (err) {
        retryCount++;
        if (retryCount < maxRetries) {
            console.log(`正在重试数据库连接 (${retryCount}/${maxRetries})...`);
            setTimeout(initializeDatabase, 2000 * retryCount);
        } else {
            console.error('❌ 数据库连接失败，已达到最大重试次数:', err);
            process.exit(1);
        }
    }
}


initializeDatabase();

// Test database connection
pool.query('SELECT NOW()', (err) => {
    if (err) {
        console.error('Database connection error', err.stack);
    } else {
        console.log('Successfully connected to PostgreSQL database');
    }
});

// Get filter options for dropdowns
app.get('/api/filters', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM filter_values LIMIT 1');
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ error: 'No filter values found' });
        }
    } catch (err) {
        console.error('Error fetching filters:', err);
        res.status(500).json({ error: 'Failed to fetch filter values' });
    }
});

// Search strains with filters and pagination
app.get('/api/strains/search', async (req, res) => {
    const {
        query = '',
        country,
        region,
        disease,
        drugResistance,
        page = 1,
        pageSize = 20
    } = req.query;

    try {
        // Build the WHERE clause based on filters
        const whereClauses = [];
        const queryParams = [];
        let paramIndex = 1;

        // Add search query condition
        if (query) {
            whereClauses.push(`(s.strain_id ILIKE $${paramIndex} OR s.gene_seq ILIKE $${paramIndex})`);
            queryParams.push(`%${query}%`);
            paramIndex++;
        }

        // Add filter conditions
        if (country) {
            whereClauses.push(`c.name = $${paramIndex}`);
            queryParams.push(country);
            paramIndex++;
        }

        if (region) {
            whereClauses.push(`r.name = $${paramIndex}`);
            queryParams.push(region);
            paramIndex++;
        }

        if (disease) {
            whereClauses.push(`d.name = $${paramIndex}`);
            queryParams.push(disease);
            paramIndex++;
        }

        if (drugResistance) {
            whereClauses.push(`dr.name = $${paramIndex}`);
            queryParams.push(drugResistance);
            paramIndex++;
        }

        // Build the base query
        let baseQuery = `
      SELECT 
        s.strain_id as "strainId",
        s.gene_seq as "geneSeq",
        c.name as country,
        r.name as region,
        d.name as disease,
        dr.name as "drugResistance"
      FROM strains s
      LEFT JOIN countries c ON s.country_id = c.id
      LEFT JOIN regions r ON s.region_id = r.id
      LEFT JOIN diseases d ON s.disease_id = d.id
      LEFT JOIN drug_resistances dr ON s.drug_resistance_id = dr.id
    `;

        // Add WHERE clause if there are any conditions
        if (whereClauses.length > 0) {
            baseQuery += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        // Get total count for pagination
        const countQuery = `SELECT COUNT(*) FROM (${baseQuery}) as total`;
        const countResult = await pool.query(countQuery, queryParams);
        const totalCount = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalCount / pageSize);
        const offset = (page - 1) * pageSize;

        // Add pagination to the query
        const paginatedQuery = `
      ${baseQuery}
      ORDER BY s.strain_id
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

        // Execute the paginated query
        const { rows } = await pool.query(
            paginatedQuery,
            [...queryParams, pageSize, offset]
        );

        // Return the paginated results
        res.json({
            data: rows,
            pagination: {
                page: parseInt(page, 10),
                pageSize: parseInt(pageSize, 10),
                totalCount,
                totalPages,
            },
        });
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: 'Failed to perform search' });
    }
});

// Export search results as CSV
app.get('/api/strains/export', async (req, res) => {
    try {
        // This is a simplified version - you might want to reuse the search query logic
        const query = `
      SELECT 
        s.strain_id as "strainId",
        s.gene_seq as "geneSeq",
        c.name as country,
        r.name as region,
        d.name as disease,
        dr.name as "drugResistance"
      FROM strains s
      LEFT JOIN countries c ON s.country_id = c.id
      LEFT JOIN regions r ON s.region_id = r.id
      LEFT JOIN diseases d ON s.disease_id = d.id
      LEFT JOIN drug_resistances dr ON s.drug_resistance_id = dr.id
      ORDER BY s.strain_id
    `;

        const { rows } = await pool.query(query);

        // Convert to CSV
        const header = ['Strain ID', 'Gene Sequence', 'Country', 'Region', 'Disease', 'Drug Resistance'];
        const csvRows = [header.join(',')];

        for (const row of rows) {
            const values = [
                `"${row.strainId}"`,
                `"${row.geneSeq}"`,
                `"${row.country || ''}"`,
                `"${row.region || ''}"`,
                `"${row.disease || ''}"`,
                `"${row.drugResistance || ''}"`
            ];
            csvRows.push(values.join(','));
        }

        const csvContent = csvRows.join('\n');

        // Set headers for file download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=strains_export.csv');
        res.send(csvContent);

    } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({ error: 'Failed to export data' });
    }
});

// Serve index.html for all other routes (SPA support)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
