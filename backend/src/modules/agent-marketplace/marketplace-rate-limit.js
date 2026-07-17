const buckets = new Map();

function rateLimit({ windowMs = 60_000, max = 30, keyPrefix = 'marketplace' } = {}) {
  return (req, res, next) => {
    const identity = req.user?.user_id || req.ip || 'anonymous';
    const key = `${keyPrefix}:${identity}`;
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || current.expiresAt <= now) {
      buckets.set(key, { count: 1, expiresAt: now + windowMs });
      next();
      return;
    }
    current.count += 1;
    if (current.count > max) {
      res.status(429).json({ code: 42901, message: '请求较多，请稍后再试', data: null });
      return;
    }
    next();
  };
}

module.exports = { rateLimit };
