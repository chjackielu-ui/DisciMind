// 数据库连接封装 — 基于 Prisma 7 + @prisma/adapter-mariadb
// 初始化方式与 backend/prisma/seed.js 保持一致
// 统一导出 prisma 单例，所有业务模块通过 require('../config/prisma') 引入
// 不要在业务文件中重复 new PrismaClient()

require('dotenv/config');

const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');

// 直接把连接配置传给 PrismaMariaDb，由适配器内部管理连接池
const adapter = new PrismaMariaDb({
  host: process.env.DATABASE_HOST || 'localhost',
  port: Number(process.env.DATABASE_PORT) || 3306,
  user: process.env.DATABASE_USER || 'root',
  password: process.env.DATABASE_PASSWORD || '',
  database: process.env.DATABASE_NAME || 'discimind',
  connectionLimit: 5,
});

// 创建 PrismaClient 单例
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
