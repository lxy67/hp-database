# HP菌数据库系统

## 项目结构

```
.
├── public/                  # 前端静态文件
│   └── index.html          # 前端主页面
├── .env                    # 环境变量配置
├── database.sql            # 数据库SQL文件（包含数据）
├── import_data.py          # 数据导入脚本（本地使用）
├── package.json            # Node.js 依赖配置
└── server.js               # 后端服务器
```

## 环境变量配置 (.env)

```env
# 数据库配置
DATABASE_URL=postgresql://username:password@host:port/dbname

# 服务器配置
PORT=3000
JWT_SECRET=your_jwt_secret
NODE_ENV=production
```

## 本地开发

1. 安装依赖
   ```bash
   npm install
   ```

2. 生成数据库SQL文件
   ```bash
   # 确保已安装Python和psycopg2
   pip install psycopg2-binary pandas python-dotenv
   
   # 生成SQL文件
   python import_data.py
   ```

3. 启动开发服务器
   ```bash
   npm run dev
   ```

## 部署到 Zeabur

1. 生成数据库SQL文件（如果尚未生成）
   ```bash
   python import_data.py
   ```

2. 提交代码到GitHub
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin 你的GitHub仓库URL
   git push -u origin main
   ```

3. 登录 [Zeabur](https://zeabur.com)

4. 点击 "New Project" > "Import from GitHub"

5. 选择你的仓库

6. 在项目设置中添加环境变量
   - 从 `.env` 文件中复制
   - 确保 `DATABASE_URL` 设置为你的PostgreSQL连接字符串

7. 在Zeabur的部署设置中，添加构建命令：
   ```
   npm install && npm run setup-db
   ```

8. 部署应用

## 数据更新

1. 本地更新 `merged_final_results123_top101.csv` 文件
2. 运行 `python import_data.py` 重新生成 `database.sql`
3. 提交更改并推送到GitHub
4. Zeabur 会自动重新部署

## 访问应用

部署完成后，你的应用将可以在 Zeabur 提供的 URL 上访问。
