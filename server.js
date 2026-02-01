const express = require('express');
const fetch = require('node-fetch');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 8080;

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Expose-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// FIX #1: Manual body reader.
// express.raw({ type: '*/*' }) checks the Content-Type header before parsing.
// If Content-Type is missing it silently skips — req.body stays undefined.
// Cinema OS video source POSTs often have NO Content-Type, so the body was
// forwarded as empty and the video CDN returned 400 Bad Request.
// This reads raw bytes on every POST/PUT/PATCH unconditionally.
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

function encodeProxyUrl(url) {
  return Buffer.from(url).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function decodeProxyUrl(encoded) {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (base64.length % 4)) % 4;
    const decoded = Buffer.from(base64 + '='.repeat(padding), 'base64').toString('utf-8');
    if (!decoded.startsWith('http://') && !decoded.startsWith('https://')) {
      throw new Error('Invalid URL scheme');
    }
    return decoded;
  } catch (e) {
    throw new Error(`Failed to decode URL: ${e.message}`);
  }
}

function rewriteHtml(html, baseUrl, proxyPrefix) {
  let rewritten = html;
  const origin = new URL(baseUrl).origin;

  // Block service workers
  rewritten = rewritten.replace(/navigator\.serviceWorker/g, 'navigator.__blockedServiceWorker');
  rewritten = rewritten.replace(/'serviceWorker'/g, "'__blockedServiceWorker'");
  rewritten = rewritten.replace(/"serviceWorker"/g, '"__blockedServiceWorker"');

  // Strip security meta tags
  rewritten = rewritten.replace(/<meta http-equiv="Content-Security-Policy".*?>/gi, '');
  rewritten = rewritten.replace(/<meta.*?name="referrer".*?>/gi, '');
  rewritten = rewritten.replace(/integrity="[^"]*"/gi, '');
  rewritten = rewritten.replace(/crossorigin="[^"]*"/gi, '');
  rewritten = rewritten.replace(/\s+crossorigin/gi, '');

  // Rewrite src/href
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
    } catch (e) { return match; }
  });

  // Inject proxy interceptor at start of <head>
  const proxyScript = `
    <script>
      (function() {
        const currentOrigin = window.location.origin;
        const targetOrigin = '${origin}';
        const inFlight = new Set();

        // Kill service workers
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

        function safeEncodeUrl(url) {
          try {
            const encoded = btoa(url).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
            return currentOrigin + '/ocho/' + encoded;
          } catch (e) { return null; }
        }

        // Intercept fetch
        const origFetch = window.fetch;
        window.fetch = function(url, opts = {}) {
          let urlStr = typeof url === 'string' ? url : url.url;

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

          const proxied = safeEncodeUrl(fullUrl);
          if (!proxied) return Promise.reject(new Error('Invalid URL'));

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
            const proxied = safeEncodeUrl(fullUrl);
            if (proxied) url = proxied;
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
              const proxied = safeEncodeUrl(fullUrl);
              if (proxied) window.location.href = proxied;
            }
          }
        }, true);
      })();
    </script>
  `;

  rewritten = rewritten.replace(/<head[^>]*>/i, (match) => match + proxyScript);
  return rewritten;
}

async function doProxyRequest(targetUrl, req, res) {
  try {
    const urlObj = new URL(targetUrl);

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

    // FIX #2: Origin / Referer.
    //
    // The flow: cinemaos.tech/player/123 fetches video from cdn.hobbism.com
    // That CDN checks Origin against cinemaos.tech (the player site), NOT against itself.
    //
    // What the browser actually sends us as Referer:
    //   https://yourrender.app/ocho/aHR0cHM6Ly9jaW5lbWFvc...  (base64 of cinemaos.tech/player/123)
    //
    // We decode that base64 → recover cinemaos.tech → send THAT as Origin + Referer.
    // Before this fix: Origin was set to hobbism.com → CDN rejected → 400.
    try {
      let originToSend = urlObj.origin;
      let refererToSend = urlObj.origin + '/';

      if (req.headers.referer && req.headers.referer.includes('/ocho/')) {
        const refUrl = new URL(req.headers.referer);
        const ochoParts = refUrl.pathname.split('/ocho/');
        if (ochoParts.length > 1) {
          const encodedPart = ochoParts[1].split('/')[0].split('?')[0];
          const decodedOrigUrl = decodeProxyUrl(encodedPart);
          originToSend = new URL(decodedOrigUrl).origin;
          refererToSend = decodedOrigUrl;
        }
      }

      headers['Origin'] = originToSend;
      headers['Referer'] = refererToSend;
    } catch (e) {
      headers['Origin'] = urlObj.origin;
      headers['Referer'] = urlObj.origin + '/';
    }

    const fetchOptions = {
      method: req.method,
      headers: headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(60000)
    };

    // req.body is always a Buffer now (from manual reader above). Check length.
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && req.body.length > 0) {
      fetchOptions.body = req.body;
    }

    const response = await fetch(targetUrl, fetchOptions);
    const contentLength = parseInt(response.headers.get('content-length') || '0');
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': '*',
      'Content-Security-Policy': "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; style-src * 'unsafe-inline';",
      'X-Frame-Options': 'ALLOWALL',
      'Content-Type': contentType
    });

    // Forward video streaming headers (needed for seeking)
    if (response.headers.get('content-length')) res.set('Content-Length', response.headers.get('content-length'));
    if (response.headers.get('content-range')) res.set('Content-Range', response.headers.get('content-range'));
    if (response.headers.get('accept-ranges')) res.set('Accept-Ranges', response.headers.get('accept-ranges'));

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) res.set('set-cookie', setCookie);

    res.status(response.status);

    // Rewrite HTML only; stream everything else
    if (contentType.includes('text/html') && contentLength < 5 * 1024 * 1024) {
      const text = await response.text();
      const rewritten = rewriteHtml(text, targetUrl, '/ocho/');
      res.send(rewritten);
    } else {
      response.body.pipe(res);
      req.on('close', () => { if (response.body.destroy) response.body.destroy(); });
    }
  } catch (error) {
    console.error(`Proxy error for ${targetUrl}:`, error.message);
    if (!res.headersSent) {
      const status = error.name === 'AbortError' ? 504 : error.code === 'ECONNREFUSED' ? 502 : 500;
      res.status(status).json({ error: 'Proxy error', message: error.message });
    }
  }
}

// Service worker — kills caches and unregisters
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

// API encoder — tvplayer.html calls this to get proxy URLs
app.get('/api/encode', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const fullUrl = url.startsWith('http') ? url : 'https://' + url;
  res.json({ encoded: encodeProxyUrl(fullUrl), proxyUrl: `/ocho/${encodeProxyUrl(fullUrl)}` });
});

// Main proxy route
app.use('/ocho/:url(*)', (req, res) => {
  try {
    let targetUrl = decodeProxyUrl(req.params.url);
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    if (queryString) targetUrl += queryString;
    doProxyRequest(targetUrl, req, res);
  } catch (e) {
    console.error('URL decode error:', e.message);
    if (!res.headersSent) res.status(400).send('Invalid URL encoding');
  }
});

// Catch-all — fixes leaked relative requests from proxied pages
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
        console.log(`Catch-all: ${req.url} -> ${fixedUrl}`);
        return doProxyRequest(fixedUrl, req, res);
      }
    } catch (e) {
      console.error('Catch-all error:', e.message);
    }
  }

  res.status(404).json({ error: 'Not Found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎬 AuraBaby Media running on port ${PORT}`);
  console.log(`📡 Proxy: /ocho/`);
  console.log(`🔧 Encoder: /api/encode`);
});
