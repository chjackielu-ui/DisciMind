const { loadEnv } = require('./env');

loadEnv();

function cleanEnvValue(value) {
  if (value == null) return '';
  return String(value).trim().replace(/^['"]|['"]$/g, '');
}

function decodeUrlPart(value) {
  try {
    return decodeURIComponent(value || '');
  } catch {
    return value || '';
  }
}

function parseDatabaseUrl(rawUrl) {
  const value = cleanEnvValue(rawUrl);
  if (!value) return null;

  let url;
  try {
    url = new URL(value);
  } catch (err) {
    throw Object.assign(
      new Error(`DATABASE_URL 格式不正确，请使用 mysql://user:password@host:port/database 格式。原始错误：${err.message}`),
      { code: 'ENV_DATABASE_URL_INVALID' },
    );
  }

  if (!['mysql:', 'mariadb:'].includes(url.protocol)) {
    throw Object.assign(
      new Error('DATABASE_URL 协议不正确，请使用 mysql:// 或 mariadb://'),
      { code: 'ENV_DATABASE_URL_INVALID' },
    );
  }

  const database = decodeUrlPart(url.pathname.replace(/^\/+/, ''));
  if (!database) {
    throw Object.assign(
      new Error('DATABASE_URL 缺少数据库名，例如 /discimind'),
      { code: 'ENV_DATABASE_URL_INVALID' },
    );
  }

  return {
    host: url.hostname || 'localhost',
    port: Number(url.port) || 3306,
    user: decodeUrlPart(url.username || 'root'),
    password: decodeUrlPart(url.password || ''),
    database,
    connectionLimit: Number(process.env.DATABASE_CONNECTION_LIMIT) || 5,
  };
}

function getDatabaseConfig() {
  const fromUrl = parseDatabaseUrl(process.env.DATABASE_URL);
  if (fromUrl) return fromUrl;

  return {
    host: cleanEnvValue(process.env.DATABASE_HOST) || 'localhost',
    port: Number(process.env.DATABASE_PORT) || 3306,
    user: cleanEnvValue(process.env.DATABASE_USER) || 'root',
    password: cleanEnvValue(process.env.DATABASE_PASSWORD) || '',
    database: cleanEnvValue(process.env.DATABASE_NAME) || 'discimind',
    connectionLimit: Number(process.env.DATABASE_CONNECTION_LIMIT) || 5,
  };
}

function describeDatabaseError(err) {
  const message = String(err?.message || err || '');
  const code = String(err?.code || '');

  if (code === 'ENV_DATABASE_URL_INVALID') return message;
  if (!process.env.DATABASE_URL && !process.env.DATABASE_NAME) {
    return '缺少数据库配置：请在 backend/.env 中配置 DATABASE_URL，或配置 DATABASE_HOST/DATABASE_PORT/DATABASE_USER/DATABASE_PASSWORD/DATABASE_NAME。';
  }
  if (/ECONNREFUSED|Can't reach database server|connect ECONNREFUSED/i.test(message)) {
    return '数据库服务未启动或地址/端口不可达，请检查 MySQL 服务、主机和端口。';
  }
  if (/Access denied|ER_ACCESS_DENIED_ERROR|authentication/i.test(message)) {
    return '数据库用户名或密码错误，请检查 DATABASE_URL 或 DATABASE_USER/DATABASE_PASSWORD。';
  }
  if (/Unknown database|ER_BAD_DB_ERROR|database .* does not exist/i.test(message)) {
    return '数据库不存在，请先创建 discimind 数据库或检查 DATABASE_URL 中的数据库名。';
  }
  if (/doesn't exist|does not exist|Table .* doesn't exist|relation .* does not exist/i.test(message)) {
    return '数据库表不存在或迁移尚未执行，请运行 npx prisma migrate dev。';
  }
  if (/pool timeout|Timed out fetching a new connection/i.test(message)) {
    return '数据库连接池超时，请检查 MySQL 连接数、服务状态和 DATABASE_CONNECTION_LIMIT。';
  }

  return message || '未知数据库连接错误';
}

module.exports = {
  getDatabaseConfig,
  describeDatabaseError,
};
