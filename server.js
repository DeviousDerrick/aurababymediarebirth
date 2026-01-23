import express from 'express';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import { URL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 8080;

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

// CORS Middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.raw({ type: '*/*', limit: '10mb' }));

// Encode/Decode URL
function encodeProxyUrl(url) {
  return Buffer.from(url).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function decodeProxyUrl(encoded) {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (base64.length % 4)) % 4;
  return Buffer.from(base64 + '='.repeat(padding), 'base64').toString('utf-8');
}

// API Encoder
app.get('/api/encode', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const fullUrl = url.startsWith('http') ? url : 'https://' + url;
  res.json({ encoded: encodeProxyUrl(fullUrl), proxyUrl: `/ocho/${encodeProxyUrl(fullUrl)}` });
});

// Proxy route
app.use('/ocho/:url(*)', async (req, res) => {
  const encodedUrl = req.params.url;
  try {
    let targetUrl = decodeProxyUrl(encodedUrl);
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    targetUrl += queryString;

    const headers = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Encoding': 'identity',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}),
      ...(req.headers.referer ? { Referer: req.headers.referer } : {})
    };

    const options = {
      method: req.method,
      headers,
      redirect: 'follow',
      body: ['POST','PUT','PATCH'].includes(req.method) ? req.body : undefined,
      signal: AbortSignal.timeout(30000)
    };

    const response = await fetch(targetUrl, options);
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    res.set('Content-Type', contentType);

    if (contentType.includes('text/html')) {
      let text = await response.text();
      res.send(text);
    } else {
      response.body.pipe(res);
    }

  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Kill Service Worker
app.get('/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send(`
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', () => {
      self.registration.unregister().then(() => console.log('Zombie SW killed'));
    });
  `);
});

// Start server
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
