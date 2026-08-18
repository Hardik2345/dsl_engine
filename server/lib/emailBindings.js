const SAFE_PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const TOKEN_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}/g;

function isSafeBindingPath(path) {
  if (typeof path !== 'string' || !SAFE_PATH_RE.test(path.trim())) return false;
  return !path.trim().split('.').some((segment) => ['__proto__', 'prototype', 'constructor'].includes(segment));
}

function resolveBinding(root, path) {
  if (!isSafeBindingPath(path)) {
    return { found: false, value: undefined };
  }

  let value = root;
  for (const segment of path.trim().split('.')) {
    if (value == null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, segment)) {
      return { found: false, value: undefined };
    }
    value = value[segment];
  }

  return { found: true, value };
}

function renderBindingTemplate(template, context) {
  return String(template || '').replace(TOKEN_RE, (_, path) => {
    const resolved = resolveBinding(context, path);
    if (!resolved.found || resolved.value == null) {
      throw new Error(`missing required binding: ${path}`);
    }
    if (typeof resolved.value === 'object') {
      throw new Error(`binding must resolve to a scalar value: ${path}`);
    }
    return String(resolved.value);
  });
}

module.exports = {
  SAFE_PATH_RE,
  isSafeBindingPath,
  resolveBinding,
  renderBindingTemplate,
};
