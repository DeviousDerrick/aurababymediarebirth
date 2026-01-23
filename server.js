import express from 'express';
import fetch from 'node-fetch';
import { URL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Serve static files
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

function encodeProxyUrl(url) {
  return Buffer.from(url).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function decodeProxyUrl(encoded) {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (base64.length % 4)) % 4;
  return Buffer.from(base64 + '='.repeat(padding), 'base64').toString('utf-8');
}

// API Encode
app.get('/api/encode', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const fullUrl = url.startsWith('http') ? url : 'https://' + url;
  res.json({ encoded: encodeProxyUrl(fullUrl), proxyUrl: `/ocho/${encodeProxyUrl(fullUrl)}` });
});

// Proxy requests
app.use('/ocho/:url(*)', async (req, res) => {
  const encodedUrl = req.params.url;
  try {
    const targetUrl = decodeProxyUrl(encodedUrl);
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    const finalUrl = targetUrl + queryString;

    const response = await fetch(finalUrl, { method: req.method });
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    res.set('Content-Type', contentType);

    if (contentType.includes('text/html')) {
      let text = await response.text();
      res.send(text);
    } else {
      response.body.pipe(res);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Project Ocho listening on port ${PORT}`));
