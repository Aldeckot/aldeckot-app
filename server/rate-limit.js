const buckets = new Map();

const now = () => Date.now();

const clientAddress = request => {
  const headers = request?.headers || {};
  const value = headers['x-vercel-forwarded-for'] || headers['x-forwarded-for'] || headers['x-real-ip'] || 'unknown';
  return String(Array.isArray(value) ? value[0] : value).split(',')[0].trim() || 'unknown';
};

const pruneExpired = timestamp => {
  if (buckets.size < 250) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= timestamp) buckets.delete(key);
  }
};

const take = ({ key, limit, windowMs, timestamp = now() }) => {
  pruneExpired(timestamp);
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= timestamp
    ? { count: 0, resetAt: timestamp + windowMs }
    : current;

  if (bucket.count >= limit) {
    buckets.set(key, bucket);
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  buckets.set(key, bucket);
  return { allowed: true, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
};

const allowRequest = (request, response, { namespace, limit, windowMs }) => {
  const result = take({ key: `${namespace}:${clientAddress(request)}`, limit, windowMs });
  const retryAfter = Math.max(1, Math.ceil((result.resetAt - now()) / 1000));
  response.setHeader('RateLimit-Limit', String(limit));
  response.setHeader('RateLimit-Remaining', String(result.remaining));
  response.setHeader('RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
  if (!result.allowed) response.setHeader('Retry-After', String(retryAfter));
  return result.allowed;
};

const resetForTests = () => buckets.clear();

module.exports = { allowRequest, clientAddress, resetForTests, take };
