// ─────────────────────────────────────────────────────────────────────────────
// AuraBaby Media — Cloudflare Worker
// Handles /ocho/ proxy + serves static assets from KV (Workers Sites)
// ─────────────────────────────────────────────────────────────────────────────

import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

// ── URL ENCODING ──────────────────────────────────────────────────────────────
function encodeProxyUrl(url) {
  return btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function decodeProxyUrl(encoded) {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    // Pad to multiple of 4
    const pad = (4 - base64.length % 4) % 4;
    const decoded = atob(base64 + '='.repeat(pad));
    if (!decoded.startsWith('http://') && !decoded.startsWith('https://')) {
      throw new Error('Invalid URL scheme');
    }
    return decoded;
  } catch(e) {
    throw new Error('Failed to decode URL: ' + e.message);
  }
}

// ── HTML REWRITER ─────────────────────────────────────────────────────────────
// Cloudflare has a built-in streaming HTMLRewriter — much faster than regex
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
      if (attr.startsWith('//'))        abs = 'https:' + attr;
      else if (attr.startsWith('/'))    abs = this.origin + attr;
      else if (!attr.startsWith('http')) {
        abs = this.origin + '/' + attr;
      }
      element.setAttribute(this.attrName, this.proxyPrefix + encodeProxyUrl(abs));
    } catch(e) {}
  }
}

class HeadInjector {
  constructor(scripts) { this.scripts = scripts; }
  element(element) { element.prepend(this.scripts, { html: true }); }
}

class MetaRemover {
  element(element) { element.remove(); }
}

class ScriptRemover {
  constructor() { this.remove = false; }
  element(element) {
    const src = element.getAttribute('src') || '';
    const adPattern = /googlesyndication|doubleclick|adnxs|outbrain|taboola|popads|popcash|exoclick|adsterra|propellerads|monetag|pushcrew|onesignal/i;
    if (adPattern.test(src)) element.remove();
  }
}

function buildInjectedScripts(targetOrigin) {
  const popupNuke = `<script>
(function(){
  window.open = function(){ return { focus:function(){}, blur:function(){} }; };
  window.addEventListener('blur', function(e){ e.stopImmediatePropagation(); }, true);
  var nukeCount = 0;
  function nukeOverlays(){
    var bad = ['[id*="pop"]','[id*="overlay"]','[id*="modal"]:not(video)','[id*="interstitial"]','[class*="pop"]','[class*="ad-wrap"]'].join(',');
    try {
      document.querySelectorAll(bad).forEach(function(el){
        var z = parseInt(window.getComputedStyle(el).zIndex)||0;
        if(z > 999) el.remove();
      });
      document.querySelectorAll('iframe').forEach(function(f){
        var s=(f.src||'').toLowerCase();
        if(/(popads|popcash|exoclick|adsterra|propellerads|monetag)/.test(s)) f.remove();
      });
    } catch(e){}
    if(nukeCount++ < 20) setTimeout(nukeOverlays, 600);
  }
  document.addEventListener('DOMContentLoaded', nukeOverlays);
  setTimeout(nukeOverlays, 300);
  setTimeout(nukeOverlays, 1500);
})();
</script>`;

  const proxyScript = `<script>
(function(){
  var targetOrigin = ${JSON.stringify(targetOrigin)};
  var currentOrigin = self.location.origin;
  var inFlight = new Set();

  // Block service workers (we don't want sites hijacking requests)
  try {
    Object.defineProperty(navigator,'serviceWorker',{get:()=>undefined,configurable:false});
  } catch(e){}

  function safeEncode(url){
    try{
      return currentOrigin+'/ocho/'+btoa(url).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=/g,'');
    }catch(e){return null;}
  }

  var origFetch = self.fetch;
  self.fetch = function(url, opts){
    var s = typeof url==='string'?url:(url&&url.url)||'';
    if(!s||s.startsWith('/ocho/')||s.startsWith('data:')||s.startsWith('blob:')||s.includes(currentOrigin)) return origFetch(url,opts);
    if(inFlight.has(s)) return Promise.reject(new Error('Loop'));
    var full = s.startsWith('http')?s:(s.startsWith('/')?targetOrigin+s:targetOrigin+'/'+s);
    var p = safeEncode(full);
    if(!p) return Promise.reject(new Error('Bad URL'));
    inFlight.add(s);
    return origFetch(p,opts).finally(()=>inFlight.delete(s));
  };

  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m,url){
    if(typeof url==='string'&&!url.startsWith('/ocho/')&&!url.startsWith('data:')&&!url.startsWith('blob:')&&!url.includes(currentOrigin)){
      var full=url.startsWith('http')?url:(url.startsWith('/')?targetOrigin+url:targetOrigin+'/'+url);
      var p=safeEncode(full);
      if(p) url=p;
    }
    return origOpen.apply(this,arguments);
  };

  document.addEventListener('click',function(e){
    var link=e.target.closest('a');
    if(link&&link.href){
      var url=link.href;
      if(!url.startsWith(currentOrigin)&&!url.startsWith('javascript:')&&!url.startsWith('mailto:')&&!url.startsWith('tel:')&&!url.startsWith('#')){
        e.preventDefault();
        var full=url.startsWith('http')?url:targetOrigin+url;
        var p=safeEncode(full);
        if(p) location.href=p;
      }
    }
  },true);
})();
</script>`;

  return popupNuke + proxyScript;
}

// ── REWRITE HTML via Cloudflare HTMLRewriter ──────────────────────────────────
function rewriteHtmlResponse(response, targetUrl) {
  const urlObj    = new URL(targetUrl);
  const origin    = urlObj.origin;
  const prefix    = '/ocho/';
  const injected  = buildInjectedScripts(origin);

  return new HTMLRewriter()
    // Remove CSP and referrer meta tags
    .on('meta[http-equiv="Content-Security-Policy"]', new MetaRemover())
    .on('meta[name="referrer"]', new MetaRemover())
    // Remove ad scripts
    .on('script[src]', new ScriptRemover())
    // Inject popup nuke + fetch proxy at top of <head>
    .on('head', new HeadInjector(injected))
    // Rewrite all src/href attributes through /ocho/
    .on('[src]',  new AttributeRewriter('src',  origin, prefix))
    .on('[href]', new AttributeRewriter('href', origin, prefix))
    .on('[action]', new AttributeRewriter('action', origin, prefix))
    .transform(response);
}

// ── REWRITE m3u8 ──────────────────────────────────────────────────────────────
async function rewriteM3u8(text, targetUrl) {
  const base = new URL(targetUrl);
  return text.split('\n').map(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    try {
      let abs = t;
      if (t.startsWith('//'))      abs = 'https:' + t;
      else if (t.startsWith('/'))  abs = base.origin + t;
      else if (!t.startsWith('http')) {
        const dir = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
        abs = base.origin + dir + t;
      }
      return '/ocho/' + encodeProxyUrl(abs);
    } catch(e) { return line; }
  }).join('\n');
}

// ── REWRITE JS/JSON (proxy media URLs buried in JS) ───────────────────────────
async function rewriteJs(text) {
  return text.replace(
    /(["'`])(https?:\/\/[^"'`\s]+?\.(m3u8|mp4|ts|key|vtt|srt)[^"'`\s]*)(["'`])/gi,
    (match, q1, url, ext, q2) => {
      try { return q1 + '/ocho/' + encodeProxyUrl(url) + q2; } catch(e) { return match; }
    }
  );
}

// ── MAIN PROXY HANDLER ────────────────────────────────────────────────────────
async function handleProxy(targetUrl, request) {
  try {
    const urlObj = new URL(targetUrl);

    const headers = new Headers({
      'User-Agent':                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language':           'en-US,en;q=0.9',
      'Accept-Encoding':           'identity',
      'Referer':                   urlObj.origin + '/',
      'Origin':                    urlObj.origin,
      'Sec-Fetch-Dest':            'empty',
      'Sec-Fetch-Mode':            'cors',
      'Sec-Fetch-Site':            'same-site',
      'Upgrade-Insecure-Requests': '1',
      'Sec-CH-UA':                 '"Google Chrome";v="123", "Not:A-Brand";v="8"',
      'Sec-CH-UA-Mobile':          '?0',
      'Sec-CH-UA-Platform':        '"Windows"',
    });

    // Forward cookies/range if present
    const cookie = request.headers.get('cookie');
    const range  = request.headers.get('range');
    if (cookie) headers.set('cookie', cookie);
    if (range)  headers.set('range',  range);

    const fetchInit = {
      method:   request.method,
      headers,
      redirect: 'follow',
    };

    if (['POST','PUT','PATCH'].includes(request.method)) {
      fetchInit.body = request.body;
    }

    const upstream = await fetch(targetUrl, fetchInit);
    const ct = upstream.headers.get('content-type') || 'application/octet-stream';

    // Build clean response headers
    const resHeaders = new Headers({
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': '*',
      'Access-Control-Allow-Headers': '*',
      'Content-Security-Policy':      "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;",
      'X-Frame-Options':              'ALLOWALL',
      'Content-Type':                 ct,
    });

    // Forward useful headers
    for (const h of ['content-length','content-range','accept-ranges','cache-control','etag','last-modified']) {
      const v = upstream.headers.get(h);
      if (v) resHeaders.set(h, v);
    }

    // ── Branch by content type ──
    if (ct.includes('text/html')) {
      // Stream through HTMLRewriter — no need to buffer the whole page
      const rewritten = rewriteHtmlResponse(
        new Response(upstream.body, { headers: resHeaders, status: upstream.status }),
        targetUrl
      );
      return rewritten;
    }

    if (ct.includes('application/x-mpegURL') || ct.includes('application/vnd.apple.mpegurl') || targetUrl.includes('.m3u8')) {
      const text     = await upstream.text();
      const rewritten = await rewriteM3u8(text, targetUrl);
      return new Response(rewritten, { status: upstream.status, headers: resHeaders });
    }

    if (ct.includes('application/json') || ct.includes('javascript')) {
      const text     = await upstream.text();
      const rewritten = await rewriteJs(text);
      return new Response(rewritten, { status: upstream.status, headers: resHeaders });
    }

    // Binary / video — stream directly
    return new Response(upstream.body, { status: upstream.status, headers: resHeaders });

  } catch(err) {
    return new Response(JSON.stringify({ error: 'Proxy error', message: err.message, url: targetUrl }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
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
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      }
    });
  }

  // ── /ocho/:encoded — proxy route ──
  if (pathname.startsWith('/ocho/')) {
    const encoded = pathname.slice('/ocho/'.length);
    try {
      let targetUrl = decodeProxyUrl(encoded);
      if (url.search) targetUrl += url.search;
      return await handleProxy(targetUrl, request);
    } catch(e) {
      return new Response(JSON.stringify({ error: 'Bad URL encoding', message: e.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // ── Stub service worker ──
  if (pathname === '/sw.js') {
    return new Response(
      `self.addEventListener('install',()=>self.skipWaiting());
       self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister()));
       self.addEventListener('fetch',e=>e.respondWith(fetch(e.request)));`,
      { headers: { 'Content-Type': 'application/javascript' } }
    );
  }

  // ── Static assets from KV (Workers Sites / wrangler) ──
  try {
    return await getAssetFromKV(event);
  } catch(e) {
    // Try fallback for referer-based relative URL resolution
    const referer = request.headers.get('referer') || '';
    if (referer.includes('/ocho/')) {
      try {
        const refUrl   = new URL(referer);
        const parts    = refUrl.pathname.split('/ocho/');
        if (parts.length > 1) {
          const encoded    = parts[1].split('?')[0];
          const targetRef  = decodeProxyUrl(encoded);
          const targetObj  = new URL(targetRef);
          const fixedUrl   = pathname.startsWith('/')
            ? targetObj.origin + pathname + url.search
            : targetObj.origin + '/' + pathname + url.search;
          return await handleProxy(fixedUrl, request);
        }
      } catch(e2) {}
    }

    return new Response('Not Found', { status: 404 });
  }
}
