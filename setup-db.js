const { Client } = require('pg');
const fs = require('fs');

async function setupDatabase() {
    console.log('DATABASE_URL:', process.env.DATABASE_URL);

    if (!process.env.DATABASE_URL) {
        console.error('❌ 错误：未设置 DATABASE_URL 环境变量');
        process.exit(1);
    }

    const config = {
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false,
            sslmode: 'require'
        }
    };

    const client = new Client(config);

    try {
        console.log('正在连接到数据库...');
        await client.connect();
        console.log('✅ 成功连接到数据库');

        console.log('正在读取 SQL 文件...');
        const sql = fs.readFileSync('database.sql', 'utf8');
        
        // Execute SQL commands one by one
        const commands = sql.split(';').filter(cmd => cmd.trim() !== '');
        console.log(`找到 ${commands.length} 条SQL命令`);

        for (let i = 0; i < commands.length; i++) {
            const command = commands[i].trim();
            if (command) {
                console.log(`执行命令 ${i + 1}/${commands.length}...`);
                try {
                    await client.query(command);
                } catch (err) {
                    console.error(`❌ 命令执行失败 (${i + 1}):`, command.substring(0, 100) + '...');
                    throw err;
                }
            }
        }

        console.log('✅ 数据库设置完成');
    } catch (err) {
        console.error('❌ 数据库设置失败:');
        console.error('错误信息:', err.message);
        if (err.code) console.error('错误代码:', err.code);
        if (err.position) console.error('错误位置:', err.position);
        process.exit(1);
    } finally {
        await client.end();
    }
}

// 执行设置
setupDatabase();
