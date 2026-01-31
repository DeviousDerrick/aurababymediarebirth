/* =========================
   Imports & App Setup
========================= */
const express = require('express');
const fetch = require('node-fetch');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 8080;

/* =========================
   Global Middleware
========================= */

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Body + static files
app.use(express.raw({ type: '*/*', limit: '10mb' }));
app.use(express.static('public'));

/* =========================
   URL Encoding Helpers
========================= */
function encodeProxyUrl(url) {
  return Buffer.from(url)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function decodeProxyUrl(encoded) {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (base64.length % 4)) % 4;

  return Buffer.from(base64 + '='.repeat(padding), 'base64').toString('utf-8');
}

/* =========================
   HTML Rewriter
========================= */
function rewriteHtml(html, baseUrl, proxyPrefix) {
  let rewritten = html;
  const origin = new URL(baseUrl).origin;

  // Block service workers
  rewritten = rewritten
    .replace(/navigator\.serviceWorker/g, 'navigator.__blockedServiceWorker')
    .replace(/'serviceWorker'/g, "'__blockedServiceWorker'")
    .replace(/"serviceWorker"/g, '"__blockedServiceWorker"');

  // Remove security blockers
  rewritten = rewritten
    .replace(/<meta http-equiv="Content-Security-Policy".*?>/gi, '')
    .replace(/<meta.*?name="referrer".*?>/gi, '')
    .replace(/integrity="[^"]*"/gi, '')
    .replace(/crossorigin="[^"]*"/gi, '')
    .replace(/\s+crossorigin/gi, '');

  // Rewrite src / href URLs
  rewritten = rewritten.replace(
    /(src|href)=["']([^"']+)["']/gi,
    (match, attr, url) => {
      if (
        url.startsWith('data:') ||
        url.startsWith('blob:') ||
        url.startsWith('#') ||
        url.startsWith('javascript:') ||
        url.includes('/ocho/')
      ) {
        return match;
      }

      try {
        let absoluteUrl = url;

        if (url.startsWith('//')) {
          absoluteUrl = 'https:' + url;
        } else if (url.startsWith('/')) {
          absoluteUrl = origin + url;
        } else if (!url.startsWith('http')) {
          const base = new URL(baseUrl);
          const path =
            base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
          absoluteUrl = base.origin + path + url;
        }

        return `${attr}="${proxyPrefix}${encodeProxyUrl(absoluteUrl)}"`;
      } catch {
        return match;
      }
    }
  );

  // Inject proxy script
  rewritten = rewritten.replace(
    /<head[^>]*>/i,
    match => match + getProxyScript(origin)
  );

  return rewritten;
}

/* =========================
   Injected Client Script
========================= */
function getProxyScript(targetOrigin) {
  return `
<script>
(function () {
  const currentOrigin = location.origin;
  const inFlight = new Set();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(r => r.forEach(sw => sw.unregister()));
    delete navigator.serviceWorker;
  }

  const origFetch = fetch;
  window.fetch = function (url, opts = {}) {
    const urlStr = typeof url === 'string' ? url : url.url;

    if (
      urlStr.startsWith('/ocho/') ||
      urlStr.startsWith('data:') ||
      urlStr.startsWith('blob:') ||
      urlStr.includes(currentOrigin)
    ) {
      return origFetch(url, opts);
    }

    if (inFlight.has(urlStr)) {
      return Promise.reject(new Error('Loop prevented'));
    }

    let fullUrl = urlStr.startsWith('http')
      ? urlStr
      : (urlStr.startsWith('/') ? '${targetOrigin}' : '${targetOrigin}/') + urlStr;

    const encoded = btoa(fullUrl)
      .replace(/\\+/g, '-')
      .replace(/\\//g, '_')
      .replace(/=/g, '');

    inFlight.add(urlStr);
    return origFetch(currentOrigin + '/ocho/' + encoded, opts)
      .finally(() => inFlight.delete(urlStr));
  };
})();
</script>`;
}

/* =========================
   Proxy Core Logic
========================= */
async function doProxyRequest(targetUrl, req, res) {
  try {
    const targetOrigin = new URL(targetUrl).origin;

    const headers = {
      'User-Agent': req.headers['user-agent'],
      'Accept': req.headers.accept || '*/*',
      'Accept-Encoding': 'identity',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'Referer': targetOrigin,
      'Origin': targetOrigin
    };

    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    if (req.headers.cookie) headers['Cookie'] = req.headers.cookie;

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(60000),
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : undefined
    });

    const contentType = response.headers.get('content-type') || '';
    const length = Number(response.headers.get('content-length') || 0);

    res.status(response.status);
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Content-Type': contentType
    });

    if (contentType.includes('text/html') && length < 5 * 1024 * 1024) {
      const text = await response.text();
      res.send(rewriteHtml(text, targetUrl, '/ocho/'));
    } else {
      response.body.pipe(res);
    }
  } catch (err) {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Proxy failed' });
    }
  }
}

/* =========================
   Routes
========================= */

// Service worker killer
app.get('/sw.js', (req, res) => {
  res.type('application/javascript').send(`
    self.addEventListener('install', e => self.skipWaiting());
    self.addEventListener('activate', e => e.waitUntil(self.registration.unregister()));
  `);
});

// Main proxy
app.use('/ocho/:url(*)', (req, res) => {
  try {
    let target = decodeProxyUrl(req.params.url);
    if (req.url.includes('?')) {
      target += req.url.slice(req.url.indexOf('?'));
    }
    doProxyRequest(target, req, res);
  } catch {
    res.status(400).send('Invalid URL');
  }
});

// Fallback
app.all('*', (req, res) => res.status(404).json({ error: 'Not Found' }));

/* =========================
   Start Server
========================= */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎬 AuraBaby Media running on port ${PORT}`);
  console.log(`📡 Proxy: http://localhost:${PORT}/ocho/`);
});
