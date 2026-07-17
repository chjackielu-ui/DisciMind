// 数据库连接封装 — 基于 Prisma 7 + @prisma/adapter-mariadb
// 初始化方式与 backend/prisma/seed.js 保持一致
// 统一导出 prisma 单例，所有业务模块通过 require('../config/prisma') 引入
// 不要在业务文件中重复 new PrismaClient()

const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { getDatabaseConfig } = require('./database');

// 直接把连接配置传给 PrismaMariaDb，由适配器内部管理连接池。
// 优先解析 DATABASE_URL，兼容旧版 DATABASE_HOST / DATABASE_USER 等拆分变量。
const adapter = new PrismaMariaDb(getDatabaseConfig());

// 创建 PrismaClient 单例
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
