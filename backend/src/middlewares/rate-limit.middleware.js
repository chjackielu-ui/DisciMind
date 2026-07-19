const buckets = new Map();

const MAX_BUCKETS = 10_000;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pruneBuckets(now = Date.now(), enforceCap = false) {
  for (const [key, bucket] of buckets) {
    if (bucket.expiresAt <= now) buckets.delete(key);
  }
  if (!enforceCap || buckets.size < MAX_BUCKETS) return;
  const targetSize = Math.floor(MAX_BUCKETS * 0.9);
  for (const key of buckets.keys()) {
    buckets.delete(key);
    if (buckets.size <= targetSize) break;
  }
}

const cleanupTimer = setInterval(() => pruneBuckets(), 60_000);
cleanupTimer.unref?.();

function rateLimit({ windowMs = 60_000, max = 30, keyPrefix = 'api', keyGenerator } = {}) {
  const resolvedWindowMs = positiveNumber(windowMs, 60_000);
  const resolvedMax = Math.max(1, Math.floor(positiveNumber(max, 30)));
  return (req, res, next) => {
    const identity = keyGenerator?.(req) || req.ip || req.socket?.remoteAddress || 'anonymous';
    const key = `${keyPrefix}:${identity}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.expiresAt <= now) {
      if (!bucket && buckets.size >= MAX_BUCKETS) pruneBuckets(now, true);
      bucket = { count: 0, expiresAt: now + resolvedWindowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, resolvedMax - bucket.count);
    res.setHeader('RateLimit-Limit', String(resolvedMax));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.expiresAt / 1000)));
    if (bucket.count > resolvedMax) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000))));
      return res.status(429).json({
        success: false,
        code: 42901,
        message: '请求过于频繁，请稍后再试',
        data: null,
      });
    }
    return next();
  };
}

function resetRateLimitBuckets() {
  buckets.clear();
}

module.exports = { rateLimit, resetRateLimitBuckets };
