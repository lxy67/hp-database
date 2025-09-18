const { Client } = require('pg');
const fs = require('fs');

async function setupDatabase() {
    console.log('DATABASE_URL:', process.env.DATABASE_URL); // 添加这行来调试
    
    // 确保数据库连接字符串存在
    if (!process.env.DATABASE_URL) {
        console.error('❌ 错误：未设置 DATABASE_URL 环境变量');
        process.exit(1);
    }

    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { 
            rejectUnauthorized: false 
        } : false
    });

    try {
        console.log('正在连接到数据库...');
        await client.connect();
        console.log('✅ 成功连接到数据库');

        console.log('正在读取 SQL 文件...');
        const sql = fs.readFileSync('database.sql', 'utf8');
        
        console.log('正在执行 SQL 脚本...');
        await client.query(sql);
        
        console.log('✅ 数据库设置完成');
    } catch (err) {
        console.error('❌ 数据库设置失败:', err.message);
        if (err.code === 'ECONNREFUSED') {
            console.error('无法连接到数据库。请检查：');
            console.error('1. 数据库服务是否正在运行');
            console.error('2. DATABASE_URL 是否正确');
            console.error('3. 数据库是否允许从当前IP连接');
        }
        process.exit(1);
    } finally {
        await client.end();
    }
}

// 执行设置
setupDatabase();
