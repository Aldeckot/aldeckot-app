#!/usr/bin/env node

/*
 * Prévia local do ALDECKOT.
 *
 * Serve os arquivos da pasta do projeto em http://localhost e encaminha
 * somente /api/* ao site publicado. Assim, o frontend local usa o mesmo
 * fluxo de autenticação sem expor credenciais de servidor nesta máquina.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number.parseInt(process.env.ALDECKOT_LOCAL_PORT || '4173', 10);
const apiOrigin = String(process.env.ALDECKOT_PREVIEW_API_ORIGIN || 'https://aldeckot.vercel.app').replace(/\/+$/, '');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
};

const send = (response, status, body, headers = {}) => {
  response.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  response.end(body);
};

const readRequestBody = request => new Promise((resolveBody, reject) => {
  const chunks = [];
  request.on('data', chunk => chunks.push(chunk));
  request.on('end', () => resolveBody(chunks.length ? Buffer.concat(chunks) : undefined));
  request.on('error', reject);
});

const proxyApi = async (request, response, requestUrl) => {
  const headers = new Headers();
  ['authorization', 'content-type', 'accept'].forEach(name => {
    if (request.headers[name]) headers.set(name, request.headers[name]);
  });
  const method = request.method || 'GET';
  const body = ['GET', 'HEAD'].includes(method) ? undefined : await readRequestBody(request);
  const remote = await fetch(`${apiOrigin}${requestUrl.pathname}${requestUrl.search}`, { method, headers, body });
  const remoteBody = Buffer.from(await remote.arrayBuffer());
  const contentType = remote.headers.get('content-type') || 'application/json; charset=utf-8';
  send(response, remote.status, remoteBody, { 'Content-Type': contentType });
};

const localFilePath = pathname => {
  const decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const relative = normalize(decoded).replace(/^[/\\]+/, '');
  const candidate = resolve(projectRoot, relative);
  if (candidate !== projectRoot && !candidate.startsWith(`${projectRoot}${sep}`)) return null;
  return candidate;
};

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (requestUrl.pathname.startsWith('/api/')) {
      await proxyApi(request, response, requestUrl);
      return;
    }

    const path = localFilePath(requestUrl.pathname);
    if (!path) return send(response, 403, 'Acesso negado.');
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return send(response, 404, 'Arquivo não encontrado.');
    const body = await readFile(path);
    send(response, 200, body, { 'Content-Type': contentTypes[extname(path).toLowerCase()] || 'application/octet-stream' });
  } catch (error) {
    console.error('Prévia local indisponível:', error.message || error);
    if (!response.headersSent) send(response, 502, 'Não foi possível atender esta solicitação.');
    else response.end();
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Prévia local disponível em http://localhost:${port}/`);
  console.log(`Autenticação encaminhada com segurança para ${apiOrigin}`);
});
