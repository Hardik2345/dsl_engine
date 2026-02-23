function getRetryDelayMs(retryPolicy, attempt) {
  const maxAttempts = retryPolicy?.maxAttempts || 3;
  if (attempt >= maxAttempts) return null;

  const backoffSeconds = Array.isArray(retryPolicy?.backoffSeconds)
    ? retryPolicy.backoffSeconds
    : [30, 120, 600];

  const idx = Math.max(0, Math.min(attempt - 1, backoffSeconds.length - 1));
  return backoffSeconds[idx] * 1000;
}

module.exports = {
  getRetryDelayMs
};
