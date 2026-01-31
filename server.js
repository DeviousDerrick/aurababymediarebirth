const express = require('express');
const fetch = require('node-fetch');
const { URL } = require('url');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// 1. GLOBAL CORS MIDDLEWARE
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Manual body reader — express.raw({ type: '*/*' }) silently SKIPS bodies when
// Content-Type is missing. Cinema OS video API POSTs often have no Content-Type,
// so the body was arriving empty and the video CDN returned 400.
// This middleware reads the raw body for ALL POST/PUT/PATCH requests unconditionally.
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      req.body = chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
      next();
    });
    req.on('error', () => { req.body = Buffer.alloc(0); next(); });
  } else {
    next();
  }
});
app.use(express.static('public'));

// 2. HELPER FUNCTIONS
function encodeProxyUrl(url) {
  return Buffer.from(url).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function decodeProxyUrl(encoded) {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (base64.length % 4)) % 4;
  return Buffer.from(base64 + '='.repeat(padding), 'base64').toString('utf-8');
}

function rewriteHtml(html, baseUrl, proxyPrefix) {
  let rewritten = html;
  const origin = new URL(baseUrl).origin;

  // Block Service Workers
  rewritten = rewritten.replace(/navigator\.serviceWorker/g, 'navigator.__blockedServiceWorker');
  rewritten = rewritten.replace(/'serviceWorker'/g, "'__blockedServiceWorker'");
  rewritten = rewritten.replace(/"serviceWorker"/g, '"__blockedServiceWorker"');

  // Strip security meta tags
  rewritten = rewritten.replace(/<meta http-equiv="Content-Security-Policy".*?>/gi, '');
  rewritten = rewritten.replace(/<meta.*?name="referrer".*?>/gi, '');
  rewritten = rewritten.replace(/integrity="[^"]*"/gi, '');
  rewritten = rewritten.replace(/crossorigin="[^"]*"/gi, '');
  rewritten = rewritten.replace(/\s+crossorigin/gi, '');

  // Rewrite src/href attributes
  rewritten = rewritten.replace(/(src|href)=["']([^"']+)["']/gi, (match, attr, url) => {
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('#') || url.startsWith('javascript:')) return match;
    if (url.includes('/ocho/')) return match;
    
    let absoluteUrl = url;
    try {
      if (url.startsWith('//')) absoluteUrl = 'https:' + url;
      else if (url.startsWith('/')) absoluteUrl = origin + url;
      else if (!url.startsWith('http')) {
        const baseUrlObj = new URL(baseUrl);
        const basePath = baseUrlObj.pathname.substring(0, baseUrlObj.pathname.lastIndexOf('/') + 1);
        absoluteUrl = baseUrlObj.origin + basePath + url;
      }
      
      const encoded = encodeProxyUrl(absoluteUrl);
      return `${attr}="${proxyPrefix}${encoded}"`;
    } catch (e) { 
      return match; 
    }
  });

  // Inject proxy interceptor script
  const proxyScript = `
    <script>
      (function() {
        const currentOrigin = window.location.origin;
        const targetOrigin = '${origin}';
        const inFlight = new Set();
        
        // KILL SERVICE WORKERS
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then(regs => {
            regs.forEach(reg => reg.unregister());
          });
          delete navigator.serviceWorker;
          Object.defineProperty(navigator, 'serviceWorker', {
            get: () => undefined,
            configurable: false
          });
        }
        
        // Intercept fetch
        const origFetch = window.fetch;
        window.fetch = function(url, opts) {
          let urlStr = typeof url === 'string' ? url : url.url;
          
          // Skip: already proxied, data/blob URIs, or requests to our own server
          if (urlStr.startsWith('/ocho/') || urlStr.startsWith('data:') || urlStr.startsWith('blob:') || urlStr.startsWith(currentOrigin)) {
            return origFetch(url, opts);
          }
          
          if (inFlight.has(urlStr)) {
            return Promise.reject(new Error('Loop prevented'));
          }
          
          let fullUrl = urlStr;
          if (!urlStr.startsWith('http')) {
            fullUrl = urlStr.startsWith('/') ? targetOrigin + urlStr : targetOrigin + '/' + urlStr;
          }
          
          const encoded = btoa(fullUrl).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
          const proxied = currentOrigin + '/ocho/' + encoded;
          
          inFlight.add(urlStr);
          return origFetch(proxied, opts).finally(() => inFlight.delete(urlStr));
        };
        
        // Intercept XHR
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...args) {
          if (typeof url === 'string' && !url.startsWith('/ocho/') && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith(currentOrigin)) {
            let fullUrl = url;
            if (!url.startsWith('http')) {
              fullUrl = url.startsWith('/') ? targetOrigin + url : targetOrigin + '/' + url;
            }
            const encoded = btoa(fullUrl).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
            url = currentOrigin + '/ocho/' + encoded;
          }
          return origOpen.call(this, method, url, ...args);
        };
        
        // Intercept link clicks
        document.addEventListener('click', function(e) {
          const link = e.target.closest('a');
          if (link && link.href) {
            const url = link.href;
            if (url.startsWith(targetOrigin) || (!url.startsWith(currentOrigin) && !url.startsWith('javascript:') && !url.startsWith('mailto:') && !url.startsWith('tel:') && !url.startsWith('#'))) {
              e.preventDefault();
              const fullUrl = url.startsWith('http') ? url : targetOrigin + url;
              const encoded = btoa(fullUrl).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
              window.location.href = currentOrigin + '/ocho/' + encoded;
            }
          }
        }, true);
      })();
    </script>
  `;

  rewritten = rewritten.replace(/<head[^>]*>/i, (match) => match + proxyScript);
  return rewritten;
}

// 3. CORE PROXY LOGIC
async function doProxyRequest(targetUrl, req, res) {
  console.log(`Proxying: ${req.method} ${targetUrl}`);

  try {
    const headers = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': req.headers.accept || '*/*',
      'Accept-Encoding': 'identity', 
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'Connection': 'keep-alive'
    };

    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    if (req.headers.cookie) headers['Cookie'] = req.headers.cookie;
    if (req.headers.range) headers['Range'] = req.headers.range;

    // --- ORIGIN / REFERER: THE KEY FIX ---
    // When Cinema OS player (cinemaos.tech) fetches video from a CDN (e.g. hobbism.com),
    // that CDN checks Origin against the player site, NOT against itself.
    // Our browser Referer looks like: https://ourserver.com/ocho/<base64 of cinemaos.tech/player/123>
    // We decode that to recover cinemaos.tech and send it as Origin/Referer.
    // This is what makes the CDN accept the request instead of returning 400/403.
    try {
      const targetOrigin = new URL(targetUrl).origin;
      let originToSend = targetOrigin;
      let refererToSend = targetOrigin + '/';

      // If request came from a proxied page, extract the ORIGINAL page's origin
      if (req.headers.referer && req.headers.referer.includes('/ocho/')) {
        try {
          const refUrl = new URL(req.headers.referer);
          const ochoParts = refUrl.pathname.split('/ocho/');
          if (ochoParts.length > 1) {
            const encodedPart = ochoParts[1].split('/')[0].split('?')[0];
            const decodedOrigUrl = decodeProxyUrl(encodedPart);
            if (decodedOrigUrl.startsWith('http')) {
              originToSend = new URL(decodedOrigUrl).origin;
              refererToSend = decodedOrigUrl;
              console.log(`[Origin] ${targetOrigin} <- using referring origin: ${originToSend}`);
            }
          }
        } catch (e) { /* fall through */ }
      }

      headers['Origin'] = originToSend;
      headers['Referer'] = refererToSend;
    } catch (e) {}

    const fetchOptions = {
      method: req.method,
      headers: headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(60000)
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && req.body.length > 0) {
      fetchOptions.body = req.body;
      console.log(`[Body] Forwarding ${req.body.length} bytes (Content-Type: ${req.headers['content-type'] || 'none'})`);
    } else if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      console.log(`[Body] WARNING: ${req.method} with no body (Content-Type: ${req.headers['content-type'] || 'none'})`);
    }

    const response = await fetch(targetUrl, fetchOptions);

    const contentLength = parseInt(response.headers.get('content-length') || '0');
    const MAX_SIZE = 50 * 1024 * 1024;
    
    if (contentLength > MAX_SIZE) {
      res.set('Content-Type', response.headers.get('content-type'));
      return response.body.pipe(res);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    
    const headersToSend = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': '*',
      'Content-Security-Policy': "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; style-src * 'unsafe-inline';",
      'X-Frame-Options': 'ALLOWALL',
      'Content-Type': contentType
    };

    if (response.headers.get('content-length')) headersToSend['Content-Length'] = response.headers.get('content-length');
    if (response.headers.get('content-range')) headersToSend['Content-Range'] = response.headers.get('content-range');
    if (response.headers.get('accept-ranges')) headersToSend['Accept-Ranges'] = response.headers.get('accept-ranges');

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) headersToSend['set-cookie'] = setCookie;

    res.set(headersToSend);
    res.status(response.status);

    if (contentType.includes('text/html') && contentLength < 5 * 1024 * 1024) {
      const text = await response.text();
      const rewritten = rewriteHtml(text, targetUrl, '/ocho/');
      res.send(rewritten.toLowerCase().trim().startsWith('<!doctype') ? rewritten : '<!DOCTYPE html>\n' + rewritten);
    } else {
      const stream = response.body.pipe(res);
      stream.on('error', (err) => {
        if (response.body.destroy) response.body.destroy();
        if (!res.headersSent) res.status(500).end();
      });
      req.on('close', () => {
        if (response.body.destroy) response.body.destroy();
      });
    }
  } catch (error) {
    console.error(`Proxy Fail: ${targetUrl} - ${error.message}`);
    if (!res.headersSent) {
      const status = error.name === 'AbortError' ? 504 : error.code === 'ECONNREFUSED' ? 502 : 500;
      res.status(status).json({ error: 'Proxy error', message: error.message });
    }
  }
}

// 4. KILLER SERVICE WORKER
app.get('/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send(`
    self.addEventListener('install', (e) => {
      self.skipWaiting();
      e.waitUntil(caches.keys().then(names => Promise.all(names.map(name => caches.delete(name)))));
    });
    self.addEventListener('activate', (e) => {
      e.waitUntil(self.registration.unregister().then(() => self.clients.matchAll()).then(clients => clients.forEach(c => c.navigate(c.url))));
    });
    self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request)));
  `);
});

// 5. API ENCODER
app.get('/api/encode', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const fullUrl = url.startsWith('http') ? url : 'https://' + url;
  res.json({ encoded: encodeProxyUrl(fullUrl), proxyUrl: `/ocho/${encodeProxyUrl(fullUrl)}` });
});

// 6. MAIN PROXY ROUTE
app.use('/ocho/:url(*)', (req, res) => {
  const encodedUrl = req.params.url;
  try {
    let targetUrl = decodeProxyUrl(encodedUrl);
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    if (queryString) targetUrl += queryString;
    doProxyRequest(targetUrl, req, res);
  } catch (e) {
    res.status(400).send('Invalid URL');
  }
});

// 7. CATCH-ALL for leaked relative requests
app.all('*', (req, res) => {
  const referer = req.headers.referer;
  
  if (referer && referer.includes('/ocho/')) {
    try {
      const refPath = new URL(referer).pathname;
      const parts = refPath.split('/ocho/');
      if (parts.length > 1) {
        const encodedPart = parts[1].split('/')[0].split('?')[0];
        const targetOrigin = new URL(decodeProxyUrl(encodedPart)).origin;
        const fixedUrl = targetOrigin + req.url;
        console.log(`✓ Catch-all: ${req.url} -> ${fixedUrl}`);
        return doProxyRequest(fixedUrl, req, res);
      }
    } catch (e) {
      console.error('Catch-all error:', e.message);
    }
  }
  
  res.status(404).json({ error: 'Not Found', path: req.url });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎬 AuraBaby Media + Project Ocho on port ${PORT}`);
  console.log(`📡 Proxy: /ocho/`);
  console.log(`🔧 Encoder: /api/encode`);
});
