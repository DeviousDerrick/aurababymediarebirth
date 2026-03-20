const express = require('express');
const fetch = require('node-fetch');
const { URL } = require('url');
const path = require('path');

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

app.use(express.raw({ type: '*/*', limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

  // ── POPUP & AD BLOCKER ──────────────────────────────────────
  // Remove common ad/popup script tags by src domain
  rewritten = rewritten.replace(
    /<script[^>]*src=["'][^"']*(googlesyndication|doubleclick|adnxs|outbrain|taboola|popads|popcash|exoclick|juicyads|trafficjunky|hilltopads|adsterra|propellerads|revcontent|mgid|clickadu|adcash|adskeeper|yllix|adspyglass|monetag|pushcrew|onesignal|popunder|onclick|onclickads|adfly|adf\.ly|shorte\.st|linkvertise)[^"']*["'][^>]*><\/script>/gi,
    ''
  );

  // Remove inline scripts containing popup/ad keywords
  rewritten = rewritten.replace(
    /<script(?![^>]*src)[^>]*>[\s\S]*?(popunder|pop_under|adsbygoogle|googletag|ExoLoader|adProvider|trafficjunky)[\s\S]*?<\/script>/gi,
    ''
  );

  // Neutralise window.open and document.write in remaining scripts
  rewritten = rewritten.replace(/window\.open\s*\(/g, 'void(');
  rewritten = rewritten.replace(/document\.write\s*\(/g, 'void(');

  // Inject popup nuke script at top of <head> — runs before anything else
  const popupNuke = `<script>
(function(){
  // Hard-block window.open
  window.open = function(){ return { focus:function(){}, blur:function(){} }; };

  // Block pop-under blur/focus tricks
  window.addEventListener('blur', function(e){ e.stopImmediatePropagation(); }, true);

  // Block top-level navigation redirects
  try {
    var _loc = window.location;
    Object.defineProperty(window, 'location', {
      get: function(){ return _loc; },
      set: function(v){ if(String(v).includes(window.location.hostname)) _loc.href = v; },
      configurable: false
    });
  } catch(e){}

  // Continuously nuke high-z-index overlay / ad elements
  var nukeCount = 0;
  function nukeOverlays(){
    var bad = [
      '[id*="pop"]','[id*="overlay"]','[id*="modal"]:not(video)',
      '[id*="interstitial"]','[id*="advert"]','[id*="banner-ad"]',
      '[class*="pop"]','[class*="overlay"]:not(video)',
      '[class*="interstitial"]','[class*="advert"]','[class*="ad-wrap"]'
    ].join(',');
    try {
      document.querySelectorAll(bad).forEach(function(el){
        var z = parseInt(window.getComputedStyle(el).zIndex) || 0;
        if(z > 999) el.remove();
      });
    } catch(e){}
    // Also remove any new <iframe> that points to known ad domains
    document.querySelectorAll('iframe').forEach(function(f){
      var s = (f.src||'').toLowerCase();
      if(/(popads|popcash|exoclick|adsterra|propellerads|adnxs|doubleclick|googlesyndication|trafficjunky|monetag)/.test(s)){
        f.remove();
      }
    });
    if(nukeCount++ < 20) setTimeout(nukeOverlays, 600);
  }
  document.addEventListener('DOMContentLoaded', nukeOverlays);
  setTimeout(nukeOverlays, 300);
  setTimeout(nukeOverlays, 1500);
  setTimeout(nukeOverlays, 4000);
})();
</script>`;

  rewritten = rewritten.replace(/<head[^>]*>/i, function(m){ return m + popupNuke; });
  // ── END POPUP BLOCKER ────────────────────────────────────────

  rewritten = rewritten.replace(/navigator\.serviceWorker/g, 'navigator.__blockedServiceWorker');
  rewritten = rewritten.replace(/'serviceWorker'/g, "'__blockedServiceWorker'");
  rewritten = rewritten.replace(/"serviceWorker"/g, '"__blockedServiceWorker"');

  rewritten = rewritten.replace(/<meta http-equiv="Content-Security-Policy".*?>/gi, '');
  rewritten = rewritten.replace(/<meta.*?name="referrer".*?>/gi, '');
  rewritten = rewritten.replace(/integrity="[^"]*"/gi, '');
  rewritten = rewritten.replace(/crossorigin="[^"]*"/gi, '');
  rewritten = rewritten.replace(/\s+crossorigin/gi, '');

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

  const proxyScript = `
    <script>
      (function() {
        const currentOrigin = window.location.origin;
        const targetOrigin = '${origin}';
        const inFlight = new Set();

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
          } catch (e) {
            console.error('Failed to encode URL:', url, e);
            return null;
          }
        }

        const origFetch = window.fetch;
        window.fetch = function(url, opts = {}) {
          let urlStr = typeof url === 'string' ? url : url.url;

          if (urlStr.startsWith('/ocho/') ||
              urlStr.startsWith('data:') ||
              urlStr.startsWith('blob:') ||
              urlStr.includes(currentOrigin)) {
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
          return origFetch(proxied, opts)
            .finally(() => inFlight.delete(urlStr))
            .catch(err => { throw err; });
        };

        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...args) {
          if (typeof url === 'string' &&
              !url.startsWith('/ocho/') &&
              !url.startsWith('data:') &&
              !url.startsWith('blob:') &&
              !url.includes(currentOrigin)) {
            let fullUrl = url;
            if (!url.startsWith('http')) {
              fullUrl = url.startsWith('/') ? targetOrigin + url : targetOrigin + '/' + url;
            }
            const proxied = safeEncodeUrl(fullUrl);
            if (proxied) url = proxied;
          }
          return origOpen.call(this, method, url, ...args);
        };

        document.addEventListener('click', function(e) {
          const link = e.target.closest('a');
          if (link && link.href) {
            const url = link.href;
            if (url.startsWith(targetOrigin) ||
                (!url.startsWith(currentOrigin) &&
                 !url.startsWith('javascript:') &&
                 !url.startsWith('mailto:') &&
                 !url.startsWith('tel:') &&
                 !url.startsWith('#'))) {
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

    // Use a real Chrome UA to pass Cloudflare checks
    const ua = req.headers['user-agent'] && req.headers['user-agent'].includes('Chrome')
      ? req.headers['user-agent']
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

    const headers = {
      'User-Agent': ua,
      'Accept': req.headers.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'identity',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-CH-UA': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0'
    };

    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    if (req.headers.cookie) headers['Cookie'] = req.headers.cookie;
    if (req.headers.range) headers['Range'] = req.headers.range;
    // Pass through Cloudflare clearance cookies if present
    if (req.headers['cf-clearance']) headers['cf-clearance'] = req.headers['cf-clearance'];

    headers['Referer'] = urlObj.origin + '/';
    headers['Origin'] = urlObj.origin;
    headers['Sec-Fetch-Dest'] = 'empty';
    headers['Sec-Fetch-Mode'] = 'cors';
    headers['Sec-Fetch-Site'] = 'same-site';

    const fetchOptions = {
      method: req.method,
      headers: headers,
      redirect: 'follow'
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && Buffer.isBuffer(req.body)) {
      fetchOptions.body = req.body;
    }

    console.log('Proxying:', targetUrl);
    const response = await fetch(targetUrl, fetchOptions);

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentLength = parseInt(response.headers.get('content-length') || '0');

    // Forward useful headers but strip ones that cause issues
    const forwardHeaders = [
      'content-type','content-length','content-range',
      'accept-ranges','cache-control','last-modified','etag'
    ];
    const responseHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': '*',
      'Content-Security-Policy': "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;",
      'X-Frame-Options': 'ALLOWALL',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': contentType
    };
    forwardHeaders.forEach(h => {
      const v = response.headers.get(h);
      if (v) responseHeaders[h.split('-').map(w=>w[0].toUpperCase()+w.slice(1)).join('-')] = v;
    });
    res.set(responseHeaders);

    // (headers already set above)

    res.status(response.status);

    if (contentType.includes('text/html') && contentLength < 5 * 1024 * 1024) {
      const text = await response.text();
      const rewritten = rewriteHtml(text, targetUrl, '/ocho/');
      res.send(rewritten);
    } else if (contentType.includes('application/x-mpegURL') ||
               contentType.includes('application/vnd.apple.mpegurl') ||
               targetUrl.includes('.m3u8')) {
      // Rewrite every segment/sub-playlist URL inside m3u8 through the proxy
      const text = await response.text();
      const base = new URL(targetUrl);
      const rewrittenM3u8 = text.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        try {
          let abs = trimmed;
          if (trimmed.startsWith('//'))       abs = 'https:' + trimmed;
          else if (trimmed.startsWith('/'))   abs = base.origin + trimmed;
          else if (!trimmed.startsWith('http')) {
            const dir = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
            abs = base.origin + dir + trimmed;
          }
          return '/ocho/' + encodeProxyUrl(abs);
        } catch(e) { return line; }
      }).join('\n');
      res.send(rewrittenM3u8);

    } else if (contentType.includes('application/json') ||
               contentType.includes('text/javascript') ||
               contentType.includes('application/javascript')) {
      // Rewrite stream URLs buried inside JS/JSON responses
      const text = await response.text();
      const base = new URL(targetUrl);
      // Proxy any absolute https:// URLs that look like media (m3u8, mp4, ts, key)
      const rewrittenJs = text.replace(
        /(["'`])(https?:\/\/[^"'`\s]+?\.(m3u8|mp4|ts|key|vtt|srt)[^"'`\s]*)(["'`])/gi,
        (match, q1, url, ext, q2) => {
          try {
            return q1 + '/ocho/' + encodeProxyUrl(url) + q2;
          } catch(e) { return match; }
        }
      );
      res.set('Content-Type', contentType);
      res.send(rewrittenJs);

    } else {
      response.body.pipe(res);
    }
  } catch (error) {
    console.error(`Proxy error for ${targetUrl}:`, error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Proxy error', message: error.message, url: targetUrl });
    }
  }
}

app.get('/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send(`
    self.addEventListener('install', (e) => self.skipWaiting());
    self.addEventListener('activate', (e) => e.waitUntil(self.registration.unregister()));
    self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request)));
  `);
});

app.use('/ocho/:url(*)', (req, res) => {
  try {
    let targetUrl = decodeProxyUrl(req.params.url);
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    if (queryString) targetUrl += queryString;
    doProxyRequest(targetUrl, req, res);
  } catch (e) {
    console.error('URL decode error:', e.message);
    if (!res.headersSent) {
      res.status(400).json({ error: 'Invalid URL encoding', message: e.message });
    }
  }
});

app.all('*', (req, res) => {
  const referer = req.headers.referer;

  if (referer && referer.includes('/ocho/')) {
    try {
      const refPath = new URL(referer).pathname;
      const parts = refPath.split('/ocho/');
      if (parts.length > 1) {
        // Get the full referer target URL (not just origin) so relative paths resolve correctly
        const encodedPart = parts[1].split('?')[0];
        const targetRefUrl = decodeProxyUrl(encodedPart);
        const targetRefObj = new URL(targetRefUrl);

        let fixedUrl;
        if (req.url.startsWith('/')) {
          // Absolute path - use origin
          fixedUrl = targetRefObj.origin + req.url;
        } else {
          // Relative path - resolve against full referer path
          const basePath = targetRefObj.pathname.substring(0, targetRefObj.pathname.lastIndexOf('/') + 1);
          fixedUrl = targetRefObj.origin + basePath + req.url;
        }

        console.log('Fallback resolving:', req.url, '->', fixedUrl);
        return doProxyRequest(fixedUrl, req, res);
      }
    } catch (e) {
      console.error('Fallback error:', e.message);
    }
  }

  res.status(404).json({ error: 'Not Found' });
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎬 AuraBaby Media running on port ${PORT}`);
  });
}
