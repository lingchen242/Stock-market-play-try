/**
 * 零依赖静态文件服务器：用于本地预览《股市模拟》。
 *
 * 存在的意义有两个：
 *  1. 让页面能以 http:// 协议打开（比 file:// 更接近真实浏览器环境，便于调试）；
 *  2. 让页面直接读取项目内 node_modules 里的图表库，而不必依赖公网 CDN。
 *
 * 用法：node server.mjs   （可用 PORT 环境变量改端口）
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(process.cwd());
const PORT = Number(process.env.PORT ?? 8080);
const ENTRY = '股市模拟.html';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

/** 把请求路径解析成 ROOT 内的绝对路径；越界一律拒绝。 */
function resolveTarget(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = decoded === '/' ? ENTRY : decoded.replace(/^\/+/, '');
  const abs = resolve(join(ROOT, normalize(rel)));
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return null;
  return abs;
}

const server = createServer(async (req, res) => {
  const target = resolveTarget(req.url ?? '/');
  if (target === null) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('403 路径越界');
    return;
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`404 未找到：${req.url}`);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`《股市模拟》预览服务已启动：http://127.0.0.1:${PORT}/`);
  console.log(`入口文件：${ENTRY}（根目录：${ROOT}）`);
});
