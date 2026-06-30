function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    },
    body: JSON.stringify(body)
  };
}

function text(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    },
    body
  };
}

function methodNotAllowed() {
  return json(405, { error: 'Method not allowed.' }, { allow: 'GET, POST' });
}

module.exports = {
  json,
  text,
  methodNotAllowed
};
