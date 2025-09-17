const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { Pool } = require('pg');
const { Server } = require('socket.io');
const http = require('http');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: 'Too many requests from this IP, please try again later.'
});

app.use(limiter);
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname)));

// Database setup
const db = new sqlite3.Database(process.env.DB_PATH || './database.sqlite');

// PostgreSQL connection pool
const pgPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'hpdata',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '123456',
    port: process.env.DB_PORT || 5432,
    max: 20, // max number of clients in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Test PostgreSQL connection
pgPool.query('SELECT NOW()', (err) => {
    if (err) {
        console.error('PostgreSQL connection error:', err);
    } else {
        console.log('Connected to PostgreSQL database');
    }
});

// Initialize database tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        organization TEXT NOT NULL,
        research TEXT NOT NULL,
        phone TEXT,
        verified INTEGER DEFAULT 0,
        verification_code TEXT,
        verification_expires INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME
    )`);

    // Login logs table
    db.run(`CREATE TABLE IF NOT EXISTS login_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        email TEXT,
        ip_address TEXT,
        user_agent TEXT,
        success INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Registration logs table
    db.run(`CREATE TABLE IF NOT EXISTS registration_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT,
        name TEXT,
        organization TEXT,
        ip_address TEXT,
        user_agent TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Email transporter setup
const emailTransporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Verify email connection
emailTransporter.verify((error, success) => {
    if (error) {
        console.log('Email configuration error:', error);
    } else {
        console.log('Email server is ready to send messages');
    }
});

// Helper function to send emails
async function sendEmail(to, subject, html) {
    try {
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: to,
            subject: subject,
            html: html
        };

        const result = await emailTransporter.sendMail(mailOptions);
        console.log('Email sent successfully:', result.messageId);
        return { success: true, messageId: result.messageId };
    } catch (error) {
        console.error('Email sending error:', error);
        return { success: false, error: error.message };
    }
}

// Helper function to generate verification code
function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// Routes

// Serve main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Untitled-1.html'));
});

// Send verification code
app.post('/api/send-verification', async (req, res) => {
    const { email, phone } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    // Check if email already exists
    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (row) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const verificationCode = generateVerificationCode();
        const expires = Date.now() + 10 * 60 * 1000; // 10 minutes

        // Store verification code temporarily
        db.run(
            'INSERT OR REPLACE INTO verification_temp (email, code, expires) VALUES (?, ?, ?)',
            [email, verificationCode, expires],
            async function (err) {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Failed to store verification code' });
                }

                // Send verification email
                const emailHtml = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #2c3e50;">HP数据库平台 - 邮箱验证</h2>
                        <p>您好，</p>
                        <p>您正在注册HP数据库平台账户，验证码为：</p>
                        <div style="background: #f8f9fa; padding: 20px; text-align: center; margin: 20px 0;">
                            <h1 style="color: #3498db; font-size: 36px; margin: 0;">${verificationCode}</h1>
                        </div>
                        <p>验证码有效期为10分钟，请及时使用。</p>
                        <p>如果您没有申请注册，请忽略此邮件。</p>
                        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                        <p style="color: #666; font-size: 12px;">
                            此邮件由马歇尔芨诺研究院HP数据库平台自动发送，请勿回复。
                        </p>
                    </div>
                `;

                const emailResult = await sendEmail(email, 'HP数据库平台 - 邮箱验证码', emailHtml);

                if (emailResult.success) {
                    res.json({
                        success: true,
                        message: 'Verification code sent successfully',
                        expires: expires
                    });
                } else {
                    res.status(500).json({ error: 'Failed to send verification email' });
                }
            }
        );
    });
});

// Create verification_temp table if not exists
db.run(`CREATE TABLE IF NOT EXISTS verification_temp (
    email TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    expires INTEGER NOT NULL
)`);

// User registration
app.post('/api/register', async (req, res) => {
    const { name, email, password, organization, research, phone, verificationCode } = req.body;
    const clientIP = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');

    // Validate input
    if (!name || !email || !password || !organization || !research || !verificationCode) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    // Verify verification code
    db.get('SELECT * FROM verification_temp WHERE email = ? AND code = ?', [email, verificationCode], async (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (!row) {
            return res.status(400).json({ error: 'Invalid verification code' });
        }

        if (Date.now() > row.expires) {
            return res.status(400).json({ error: 'Verification code expired' });
        }

        // Check if email already exists
        db.get('SELECT id FROM users WHERE email = ?', [email], async (err, existingUser) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            if (existingUser) {
                return res.status(400).json({ error: 'Email already registered' });
            }

            try {
                // Hash password
                const hashedPassword = await bcrypt.hash(password, 12);

                // Insert user
                db.run(
                    'INSERT INTO users (name, email, password, organization, research, phone, verified) VALUES (?, ?, ?, ?, ?, ?, 1)',
                    [name, email, hashedPassword, organization, research, phone || null],
                    function (err) {
                        if (err) {
                            console.error('Registration error:', err);
                            return res.status(500).json({ error: 'Registration failed' });
                        }

                        const userId = this.lastID;

                        // Log registration
                        db.run(
                            'INSERT INTO registration_logs (email, name, organization, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
                            [email, name, organization, clientIP, userAgent]
                        );

                        // Delete verification code
                        db.run('DELETE FROM verification_temp WHERE email = ?', [email]);

                        // Generate JWT token
                        const token = jwt.sign(
                            { userId: userId, email: email, name: name },
                            process.env.JWT_SECRET,
                            { expiresIn: process.env.JWT_EXPIRES_IN }
                        );

                        // Send notification to admin
                        const adminNotificationHtml = `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                                <h2 style="color: #2c3e50;">新用户注册通知</h2>
                                <div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">
                                    <p><strong>姓名:</strong> ${name}</p>
                                    <p><strong>邮箱:</strong> ${email}</p>
                                    <p><strong>单位:</strong> ${organization}</p>
                                    <p><strong>研究方向:</strong> ${research}</p>
                                    <p><strong>手机:</strong> ${phone || '未提供'}</p>
                                    <p><strong>注册时间:</strong> ${new Date().toLocaleString('zh-CN')}</p>
                                    <p><strong>IP地址:</strong> ${clientIP}</p>
                                </div>
                            </div>
                        `;

                        sendEmail(process.env.ADMIN_EMAIL, 'HP数据库平台 - 新用户注册', adminNotificationHtml);

                        // Emit real-time notification
                        io.emit('newRegistration', {
                            id: userId,
                            name,
                            email,
                            organization,
                            research,
                            timestamp: new Date().toISOString()
                        });

                        res.json({
                            success: true,
                            message: 'Registration successful',
                            token: token,
                            user: {
                                id: userId,
                                name,
                                email,
                                organization,
                                research
                            }
                        });
                    }
                );
            } catch (error) {
                console.error('Password hashing error:', error);
                res.status(500).json({ error: 'Registration failed' });
            }
        });
    });
});

// User login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const clientIP = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        let loginSuccess = false;
        let userId = null;

        if (user) {
            try {
                const passwordMatch = await bcrypt.compare(password, user.password);
                if (passwordMatch) {
                    loginSuccess = true;
                    userId = user.id;

                    // Update last login
                    db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

                    // Generate JWT token
                    const token = jwt.sign(
                        { userId: user.id, email: user.email, name: user.name },
                        process.env.JWT_SECRET,
                        { expiresIn: process.env.JWT_EXPIRES_IN }
                    );

                    // Send notification to admin
                    const adminNotificationHtml = `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #2c3e50;">用户登录通知</h2>
                            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">
                                <p><strong>用户:</strong> ${user.name} (${user.email})</p>
                                <p><strong>登录时间:</strong> ${new Date().toLocaleString('zh-CN')}</p>
                                <p><strong>IP地址:</strong> ${clientIP}</p>
                                <p><strong>设备信息:</strong> ${userAgent}</p>
                            </div>
                        </div>
                    `;

                    sendEmail(process.env.ADMIN_EMAIL, 'HP数据库平台 - 用户登录', adminNotificationHtml);

                    // Emit real-time notification
                    io.emit('newLogin', {
                        userId: user.id,
                        name: user.name,
                        email: user.email,
                        timestamp: new Date().toISOString(),
                        ip: clientIP
                    });

                    res.json({
                        success: true,
                        message: 'Login successful',
                        token: token,
                        user: {
                            id: user.id,
                            name: user.name,
                            email: user.email,
                            organization: user.organization,
                            research: user.research
                        }
                    });
                } else {
                    res.status(401).json({ error: 'Invalid email or password' });
                }
            } catch (error) {
                console.error('Password comparison error:', error);
                res.status(500).json({ error: 'Login failed' });
            }
        } else {
            res.status(401).json({ error: 'Invalid email or password' });
        }

        // Log login attempt
        db.run(
            'INSERT INTO login_logs (user_id, email, ip_address, user_agent, success) VALUES (?, ?, ?, ?, ?)',
            [userId, email, clientIP, userAgent, loginSuccess ? 1 : 0]
        );
    });
});

// Get user profile (protected route)
app.get('/api/profile', authenticateToken, (req, res) => {
    db.get('SELECT id, name, email, organization, research, phone, created_at, last_login FROM users WHERE id = ?',
        [req.user.userId], (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            res.json({ user });
        });
});

// Admin dashboard - get all users (public for admin panel)
app.get('/api/admin/users', (req, res) => {
    db.all('SELECT id, name, email, organization, research, verified, created_at, last_login FROM users ORDER BY created_at DESC',
        (err, users) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            res.json({ users });
        });
});

// Admin dashboard - get login logs (public for admin panel)
app.get('/api/admin/login-logs', (req, res) => {
    db.all(`SELECT l.*, u.name FROM login_logs l 
            LEFT JOIN users u ON l.user_id = u.id 
            ORDER BY l.timestamp DESC LIMIT 100`,
        (err, logs) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            res.json({ logs });
        });
});

// Admin dashboard - get registration logs (public for admin panel)
app.get('/api/admin/registration-logs', (req, res) => {
    db.all('SELECT * FROM registration_logs ORDER BY timestamp DESC LIMIT 100',
        (err, logs) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            res.json({ logs });
        });
});

// Search API endpoints

// Get filter options for search
app.get('/api/search/filters', async (req, res) => {
    try {
        const result = await pgPool.query(`
            SELECT filter_type, value, count 
            FROM filter_values 
            ORDER BY filter_type, value
        `);

        const filters = {
            raw_country: [],
            region: [],
            host_disease: [],
            drug_resistance: []
        };

        result.rows.forEach(row => {
            if (filters[row.filter_type] !== undefined) {
                filters[row.filter_type].push({
                    value: row.value,
                    count: row.count
                });
            }
        });

        res.json(filters);
    } catch (error) {
        console.error('Error fetching filter options:', error);
        res.status(500).json({ error: 'Failed to fetch filter options' });
    }
});

// Search strains
app.post('/api/search/strains', authenticateToken, async (req, res) => {
    try {
        const {
            query = '',
            filters = {},
            page = 1,
            pageSize = 20
        } = req.body;

        const offset = (page - 1) * pageSize;
        const queryParams = [];
        const whereClauses = [];

        // Add text search condition
        if (query) {
            queryParams.push(`%${query}%`);
            whereClauses.push(`(strain ILIKE $${queryParams.length} OR gene_seq ILIKE $${queryParams.length})`);
        }

        // Add filter conditions
        Object.entries(filters).forEach(([field, values]) => {
            if (Array.isArray(values) && values.length > 0) {
                const placeholders = [];
                values.forEach(value => {
                    queryParams.push(value);
                    placeholders.push(`$${queryParams.length}`);
                });
                whereClauses.push(`${field} IN (${placeholders.join(',')})`);
            }
        });

        // Build the query
        const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM strains ${whereClause}`;
        const countResult = await pgPool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);

        // Get paginated results
        const resultsQuery = `
            SELECT id, strain, raw_country, region, host_disease, drug_resistance, 
                   LENGTH(gene_seq) as gene_length
            FROM strains
            ${whereClause}
            ORDER BY strain
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `;

        const resultsParams = [...queryParams, pageSize, offset];
        const results = await pgPool.query(resultsQuery, resultsParams);

        res.json({
            data: results.rows,
            pagination: {
                total,
                page,
                pageSize,
                totalPages: Math.ceil(total / pageSize)
            }
        });

    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Get strain details by ID
app.get('/api/strains/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pgPool.query(
            'SELECT * FROM strains WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Strain not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching strain details:', error);
        res.status(500).json({ error: 'Failed to fetch strain details' });
    }
});

// Download strain data
app.post('/api/strains/download', authenticateToken, async (req, res) => {
    try {
        const { ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'No strain IDs provided' });
        }

        const result = await pgPool.query(
            'SELECT * FROM strains WHERE id = ANY($1::int[])',
            [ids]
        );

        // Set headers for file download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=strains_export.csv');

        // Convert results to CSV
        const header = Object.keys(result.rows[0] || {}).join(',');
        const rows = result.rows.map(row =>
            Object.values(row).map(field =>
                typeof field === 'string' ? `"${field.replace(/"/g, '""')}"` : field
            ).join(',')
        );

        res.send([header, ...rows].join('\n'));

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Failed to generate download' });
    }
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('Admin connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Admin disconnected:', socket.id);
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Admin dashboard available at http://localhost:${PORT}/admin.html`);
});
