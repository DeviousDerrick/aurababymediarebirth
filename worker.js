// ─────────────────────────────────────────────────────────────────────────────
// AuraBaby Media — Cloudflare Worker
// ─────────────────────────────────────────────────────────────────────────────

import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

function encodeProxyUrl(url) {
  return btoa(unescape(encodeURIComponent(url))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function decodeProxyUrl(encoded) {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - base64.length % 4) % 4;
    const decoded = decodeURIComponent(escape(atob(base64 + '='.repeat(pad))));
    if (!decoded.startsWith('http://') && !decoded.startsWith('https://')) throw new Error('Invalid URL scheme');
    return decoded;
  } catch(e) {
    throw new Error('Failed to decode URL: ' + e.message);
  }
}

// ── HTML REWRITER HANDLERS ────────────────────────────────────────────────────
class AttributeRewriter {
  constructor(attrName, origin, proxyPrefix) {
    this.attrName    = attrName;
    this.origin      = origin;
    this.proxyPrefix = proxyPrefix;
  }
  element(element) {
    const attr = element.getAttribute(this.attrName);
    if (!attr) return;
    if (attr.startsWith('data:') || attr.startsWith('blob:') ||
        attr.startsWith('#')     || attr.startsWith('javascript:') ||
        attr.includes('/ocho/')) return;
    try {
      let abs = attr;
      if (attr.startsWith('//'))       abs = 'https:' + attr;
      else if (attr.startsWith('/'))   abs = this.origin + attr;
      else if (!attr.startsWith('http')) abs = this.origin + '/' + attr;
      element.setAttribute(this.attrName, this.proxyPrefix + encodeProxyUrl(abs));
    } catch(e) {}
  }
}

class MetaRemover  { element(el) { el.remove(); } }
class ScriptRemover {
  element(el) {
    const src = el.getAttribute('src') || '';
    if (/googlesyndication|doubleclick|adnxs|popads|popcash|exoclick|adsterra|propellerads|monetag/i.test(src)) el.remove();
  }
}

class HeadInjector {
  constructor(html) { this.html = html; }
  element(el) { el.prepend(this.html, { html: true }); }
}

// ── INJECTED SCRIPTS ──────────────────────────────────────────────────────────
// This runs inside the proxied page (e.g. CinemaOS) and:
//   1. Blocks popups/ads
//   2. Intercepts fetch/XHR to route through /ocho/
//   3. Intercepts video.src so the video element loads through /ocho/ (fixes CORS)
function buildInjectedScripts(targetOrigin) {
  return `<script>
(function(){
  'use strict';
  var currentOrigin = self.location.origin;
  var targetOrigin  = ${JSON.stringify(targetOrigin)};

  // ── 1. POPUP / AD NUKE ────────────────────────────────────────────────────
  window.open = function(){ return { focus:function(){}, blur:function(){} }; };
  window.addEventListener('blur', function(e){ e.stopImmediatePropagation(); }, true);
  var nukeCount = 0;
  function nukeOverlays(){
    try {
      document.querySelectorAll('[id*="pop"],[id*="overlay"],[class*="pop"],[class*="ad-wrap"]').forEach(function(el){
        if(parseInt(getComputedStyle(el).zIndex||0) > 999) el.remove();
      });
      document.querySelectorAll('iframe').forEach(function(f){
        if(/(popads|popcash|exoclick|adsterra|propellerads|monetag)/.test((f.src||'').toLowerCase())) f.remove();
      });
    } catch(e){}
    if(nukeCount++ < 20) setTimeout(nukeOverlays, 600);
  }
  document.addEventListener('DOMContentLoaded', nukeOverlays);
  setTimeout(nukeOverlays, 300);
  setTimeout(nukeOverlays, 1500);

  // ── 2. URL ENCODER ───────────────────────────────────────────────────────
  function safeEncode(url) {
    try {
      if(!url || url.startsWith('blob:') || url.startsWith('data:')) return null;
      return currentOrigin + '/ocho/' + btoa(unescape(encodeURIComponent(url))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=/g,'');
    } catch(e) { return null; }
  }

  function shouldProxy(s) {
    if (!s) return false;
    if (s.startsWith('/ocho/'))       return false;
    if (s.startsWith('data:'))        return false;
    if (s.startsWith('blob:'))        return false;
    if (s.includes(currentOrigin))    return false;
    if (!s.startsWith('http') && !s.startsWith('//') && !s.startsWith('/')) return false;
    return true;
  }

  function toAbsolute(s) {
    if (s.startsWith('//'))     return 'https:' + s;
    if (s.startsWith('/'))      return targetOrigin + s;
    if (!s.startsWith('http'))  return targetOrigin + '/' + s;
    return s;
  }

  // ── 3. INTERCEPT fetch ───────────────────────────────────────────────────
  var origFetch = window.fetch;
  var inFlight  = new Set();
  window.fetch = function(input, opts) {
    var s = (typeof input === 'string') ? input : (input && input.url) || '';
    if (!shouldProxy(s)) return origFetch(input, opts);
    if (inFlight.has(s)) return Promise.reject(new Error('Loop'));
    var p = safeEncode(toAbsolute(s));
    if (!p) return origFetch(input, opts);
    inFlight.add(s);
    return origFetch(p, opts).finally(function(){ inFlight.delete(s); });
  };

  // ── 4. INTERCEPT XHR ─────────────────────────────────────────────────────
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === 'string' && shouldProxy(url)) {
      var p = safeEncode(toAbsolute(url));
      if (p) url = p;
    }
    return origOpen.apply(this, arguments);
  };

  // ── 5. INTERCEPT video/audio src (THE KEY FIX FOR CORS) ──────────────────
  // CinemaOS sets video.src = 'https://cdn.example.com/...' directly in JS.
  // The browser then tries to load that URL from OUR origin → CORS blocked.
  // We intercept the src setter and route it through /ocho/ instead.
  function patchMediaElement(proto) {
    var desc = Object.getOwnPropertyDescriptor(proto, 'src');
    if (!desc || !desc.set) return;
    var origSet = desc.set;
    var origGet = desc.get;
    Object.defineProperty(proto, 'src', {
      get: origGet,
      set: function(value) {
        if (typeof value === 'string' && shouldProxy(value)) {
          var abs = toAbsolute(value);
          var proxied = safeEncode(abs);
          if (proxied) { origSet.call(this, proxied); return; }
        }
        origSet.call(this, value);
      },
      configurable: true
    });
  }
  try { patchMediaElement(HTMLVideoElement.prototype); } catch(e){}
  try { patchMediaElement(HTMLAudioElement.prototype); } catch(e){}
  try { patchMediaElement(HTMLSourceElement.prototype); } catch(e){}

  // ── 6. INTERCEPT setAttribute for src on media elements ──────────────────
  var origSetAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (name === 'src' && (this instanceof HTMLVideoElement || this instanceof HTMLAudioElement || this instanceof HTMLSourceElement)) {
      if (typeof value === 'string' && shouldProxy(value)) {
        var abs = toAbsolute(value);
        var proxied = safeEncode(abs);
        if (proxied) { origSetAttr.call(this, name, proxied); return; }
      }
    }
    origSetAttr.call(this, name, value);
  };

  // ── 7. INTERCEPT link clicks ─────────────────────────────────────────────
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a');
    if (link && link.href && shouldProxy(link.href)) {
      e.preventDefault();
      var p = safeEncode(toAbsolute(link.href));
      if (p) location.href = p;
    }
  }, true);

  // Block SW so sites don't hijack our proxied requests
  try { Object.defineProperty(navigator,'serviceWorker',{get:()=>undefined,configurable:false}); } catch(e){}
})();
</script>`;
}

// ── CINEMAOS HEADER SPOOFING ──────────────────────────────────────────────────
// CinemaOS's own proxy workers check Origin/Referer and return 403 if wrong.
// Extract the expected origin from the URL's ?referer= / ?origin= params.
function getSpoofHeaders(urlObj) {
  const host = urlObj.hostname.toLowerCase();
  const isCinemaProxy = host.includes('cinemaos') || host.includes('huhululu') ||
                        host.includes('goodstream') || host.includes('vidzee') ||
                        host.includes('icefyl') || host.includes('xalaflix');

  if (!isCinemaProxy) return null;

  const refParam    = urlObj.searchParams.get('referer') || urlObj.searchParams.get('ref');
  const originParam = urlObj.searchParams.get('origin');

  if (refParam) {
    try {
      const o = new URL(refParam).origin;
      return { referer: refParam.endsWith('/') ? refParam : refParam + '/', origin: o };
    } catch(e) {}
  }
  if (originParam) {
    try {
      return { referer: originParam + '/', origin: originParam };
    } catch(e) {}
  }
  return { referer: 'https://cinemaos.tech/', origin: 'https://cinemaos.tech' };
}

// ── HTML REWRITER ─────────────────────────────────────────────────────────────
function rewriteHtmlResponse(response, targetUrl) {
  const origin   = new URL(targetUrl).origin;
  const injected = buildInjectedScripts(origin);

  return new HTMLRewriter()
    .on('meta[http-equiv="Content-Security-Policy"]', new MetaRemover())
    .on('meta[name="referrer"]', new MetaRemover())
    .on('script[src]', new ScriptRemover())
    .on('head', new HeadInjector(injected))
    .on('[src]',    new AttributeRewriter('src',    origin, '/ocho/'))
    .on('[href]',   new AttributeRewriter('href',   origin, '/ocho/'))
    .on('[action]', new AttributeRewriter('action', origin, '/ocho/'))
    .transform(response);
}

// ── M3U8 REWRITER ─────────────────────────────────────────────────────────────
async function rewriteM3u8(text, targetUrl) {
  const base = new URL(targetUrl);
  return text.split('\n').map(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    try {
      let abs = t;
      if (t.startsWith('//'))     abs = 'https:' + t;
      else if (t.startsWith('/')) abs = base.origin + t;
      else if (!t.startsWith('http')) {
        const dir = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
        abs = base.origin + dir + t;
      }
      return '/ocho/' + encodeProxyUrl(abs);
    } catch(e) { return line; }
  }).join('\n');
}

// ── JS/JSON REWRITER ──────────────────────────────────────────────────────────
async function rewriteJs(text) {
  return text.replace(
    /(["'`])(https?:\/\/[^"'`\s]+?\.(m3u8|mp4|ts|key|vtt|srt)[^"'`\s]*)(["'`])/gi,
    (match, q1, url, ext, q2) => {
      try { return q1 + '/ocho/' + encodeProxyUrl(url) + q2; } catch(e) { return match; }
    }
  );
}

// ── CORS HEADERS ──────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':   '*',
  'Access-Control-Allow-Methods':  '*',
  'Access-Control-Allow-Headers':  '*',
  'Access-Control-Expose-Headers': '*',
  'Cross-Origin-Resource-Policy':  'cross-origin',
  'Cross-Origin-Embedder-Policy':  'unsafe-none',
  'X-Frame-Options':               'ALLOWALL',
  'Content-Security-Policy':       "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;",
};

// ── MAIN PROXY HANDLER ────────────────────────────────────────────────────────
async function handleProxy(targetUrl, request) {
  try {
    const urlObj = new URL(targetUrl);
    const spoof  = getSpoofHeaders(urlObj);

    const referer = spoof ? spoof.referer : urlObj.origin + '/';
    const origin  = spoof ? spoof.origin  : urlObj.origin;

    const headers = new Headers({
      'User-Agent':                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept':                    '*/*',
      'Accept-Language':           'en-US,en;q=0.9',
      'Accept-Encoding':           'identity',
      'Referer':                   referer,
      'Origin':                    origin,
      'Sec-Fetch-Dest':            'empty',
      'Sec-Fetch-Mode':            'cors',
      'Sec-Fetch-Site':            'cross-site',
      'Sec-CH-UA':                 '"Google Chrome";v="124", "Not:A-Brand";v="8"',
      'Sec-CH-UA-Mobile':          '?0',
      'Sec-CH-UA-Platform':        '"Windows"',
    });

    const cookie = request.headers.get('cookie');
    const range  = request.headers.get('range');
    if (cookie) headers.set('cookie', cookie);
    if (range)  headers.set('range', range);

    const fetchInit = { method: request.method, headers, redirect: 'follow' };
    if (['POST','PUT','PATCH'].includes(request.method)) fetchInit.body = request.body;

    const upstream = await fetch(targetUrl, fetchInit);
    const ct = upstream.headers.get('content-type') || 'application/octet-stream';

    // Build response headers
    const resHeaders = new Headers(CORS_HEADERS);
    resHeaders.set('Content-Type', ct);
    for (const h of ['content-length','content-range','accept-ranges','cache-control','etag','last-modified']) {
      const v = upstream.headers.get(h);
      if (v) resHeaders.set(h, v);
    }

    // Branch by content type
    if (ct.includes('text/html')) {
      const rewritten = rewriteHtmlResponse(
        new Response(upstream.body, { status: upstream.status, headers: resHeaders }),
        targetUrl
      );
      return rewritten;
    }

    if (ct.includes('application/x-mpegURL') || ct.includes('application/vnd.apple.mpegurl') || targetUrl.includes('.m3u8')) {
      const text = await upstream.text();
      const out  = await rewriteM3u8(text, targetUrl);
      return new Response(out, { status: upstream.status, headers: resHeaders });
    }

    if (ct.includes('application/json') || ct.includes('javascript')) {
      const text = await upstream.text();
      const out  = await rewriteJs(text);
      resHeaders.set('Content-Type', ct);
      return new Response(out, { status: upstream.status, headers: resHeaders });
    }

    // Binary / video segment — stream directly
    return new Response(upstream.body, { status: upstream.status, headers: resHeaders });

  } catch(err) {
    return new Response(JSON.stringify({ error: 'Proxy error', message: err.message, url: targetUrl }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
}

// ── MAIN FETCH HANDLER ────────────────────────────────────────────────────────
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event));
});

async function handleRequest(request, event) {
  const url      = new URL(request.url);
  const pathname = url.pathname;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  // /ocho/:encoded proxy route
  if (pathname.startsWith('/ocho/')) {
    const encoded = pathname.slice('/ocho/'.length);
    try {
      let targetUrl = decodeProxyUrl(encoded);
      if (url.search) targetUrl += url.search;
      return await handleProxy(targetUrl, request);
    } catch(e) {
      return new Response(JSON.stringify({ error: 'Bad URL encoding', message: e.message }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }
  }

  // Stub SW
  if (pathname === '/sw.js') {
    return new Response(
      `self.addEventListener('install',()=>self.skipWaiting());
       self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister()));
       self.addEventListener('fetch',e=>e.respondWith(fetch(e.request)));`,
      { headers: { 'Content-Type': 'application/javascript' } }
    );
  }

  // Static assets
  try {
    return await getAssetFromKV(event);
  } catch(e) {
    // Referer-based fallback for relative URLs inside proxied pages
    const referer = request.headers.get('referer') || '';
    if (referer.includes('/ocho/')) {
      try {
        const refUrl  = new URL(referer);
        const parts   = refUrl.pathname.split('/ocho/');
        if (parts.length > 1) {
          const enc      = parts[1].split('?')[0];
          const ref      = decodeProxyUrl(enc);
          const refObj   = new URL(ref);
          const fixedUrl = pathname.startsWith('/')
            ? refObj.origin + pathname + url.search
            : refObj.origin + '/' + pathname + url.search;
          return await handleProxy(fixedUrl, request);
        }
      } catch(e2) {}
    }
    return new Response('Not Found', { status: 404 });
  }
}
