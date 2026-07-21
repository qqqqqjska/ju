const http = require('http');

// 要转发到的官方 MCP 根地址（不带路径）。可用 Render 环境变量 TARGET_BASE 覆盖。
// 去掉结尾多余的斜杠，避免和请求路径拼出 "//order/..." 这种双斜杠导致 404。
const TARGET = (process.env.TARGET_BASE || 'https://gwmcp.lkcoffee.com').replace(/\/+$/, '');
const PORT = process.env.PORT || 3000;

// 可选：设置 PROXY_SECRET 后，请求必须带 header  x-proxy-secret: <值>  才放行。
const SECRET = process.env.PROXY_SECRET || '';

const server = http.createServer((req, res) => {
  // CORS 头：允许网页跨域访问这个代理
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,DELETE');
  res.setHeader(
    'Access-Control-Allow-Headers',
    req.headers['access-control-request-headers'] ||
      'authorization,content-type,mcp-session-id,accept,mcp-protocol-version,x-proxy-secret'
  );
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id,MCP-Session-Id');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('proxy ok -> ' + TARGET);
    return;
  }

  if (SECRET && req.headers['x-proxy-secret'] !== SECRET) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const lk = k.toLowerCase();
      if (['host', 'origin', 'referer', 'content-length', 'connection', 'x-proxy-secret'].includes(lk)) continue;
      headers[k] = v;
    }
    try {
      const upstream = await fetch(TARGET + req.url, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
        redirect: 'manual'
      });
      const respHeaders = {};
      upstream.headers.forEach((val, key) => {
        const lk = key.toLowerCase();
        if (['content-encoding', 'transfer-encoding', 'connection', 'content-length'].includes(lk)) return;
        respHeaders[key] = val;
      });
      res.writeHead(upstream.status, respHeaders);
      if (upstream.body) {
        const reader = upstream.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      }
      res.end();
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'proxy_failed', message: String((e && e.message) || e) }));
    }
  });
});

server.listen(PORT, () => console.log('MCP CORS proxy on ' + PORT + ' -> ' + TARGET));
