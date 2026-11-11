// Tiny static server with no dependencies: `node server.js` then open http://localhost:8080
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8080);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.md': 'text/plain', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).on('error', e => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.log(`Port ${port} is already in use: the farm server is probably already running. Just open http://localhost:${port}`);
  console.log(`(To stop the old one: lsof -ti tcp:${port} | xargs kill  — or start on another port: PORT=8081 npm start)`);
  process.exit(1);
}).listen(port, () => console.log(`Farm running at http://localhost:${port}`));
