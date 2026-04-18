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

// ── MEDIA SERVICE WORKER ──────────────────────────────────────────────────────
// This SW is registered by tvplayer.html and intercepts ALL network requests
// made by the proxied page — including those from HLS.js Web Workers.
// This is the same concept as Ultraviolet but built into our own Worker.
const MEDIA_SW_CODE = `
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Domains we never want to proxy — safe APIs / CDNs
const PASSTHROUGH = [
  'api.themoviedb.org',
  'image.tmdb.org',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
];

function encode(url) {
  return btoa(unescape(encodeURIComponent(url)))
    .replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=/g,'');
}

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  const referrer = req.referrer || '';

  // 1. Same-origin requests: let through as-is
  if (url.origin === self.location.origin) return;

  // 2. Already going through /ocho/: let through
  if (url.pathname.startsWith('/ocho/')) return;

  // 3. Non-HTTP: let through
  if (!url.protocol.startsWith('http')) return;

  // 4. Safe passthrough domains: let through
  if (PASSTHROUGH.some(d => url.hostname.endsWith(d))) return;

  // 5. Only intercept requests that originate from a proxied (/ocho/) page
  //    This prevents accidentally proxying requests from app.html, index.html etc.
  let refOriginOk = false;
  try {
    const refUrl = new URL(referrer);
    refOriginOk = refUrl.pathname.startsWith('/ocho/') || refUrl.pathname === '/tvplayer.html';
  } catch(e) {}

  // Also intercept if the request itself is cross-origin (no referrer = likely from a worker)
  // and the SW was activated from a proxied page context
  if (!refOriginOk && referrer) return;

  // Route through /ocho/ proxy
  const proxied = self.location.origin + '/ocho/' + encode(url.href);

  event.respondWith(
    fetch(new Request(proxied, {
      method: req.method,
      headers: req.headers,
      body: ['GET','HEAD'].includes(req.method) ? undefined : req.body,
      redirect: 'follow',
      mode: 'cors',
      credentials: 'omit',
    })).catch(err =>
      new Response(JSON.stringify({ error: 'SW proxy error', message: err.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    )
  );
});
`;

// ── HTML REWRITER HANDLERS ────────────────────────────────────────────────────
class AttributeRewriter {
  constructor(attrName, origin) {
    this.attrName = attrName;
    this.origin   = origin;
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
      element.setAttribute(this.attrName, '/ocho/' + encodeProxyUrl(abs));
    } catch(e) {}
  }
}

class MetaRemover   { element(el) { el.remove(); } }
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

// ── INJECTED SCRIPT (runs inside proxied page) ────────────────────────────────
// Handles fetch/XHR/video.src on the main thread.
// The Service Worker handles Web Worker threads (HLS.js internals).
function buildInjectedScript(targetOrigin) {
  return `<script>
(function(){
  'use strict';
  var cur = self.location.origin;
  var tgt = ${JSON.stringify(targetOrigin)};

  // Block popups
  window.open = function(){ return { focus:function(){}, blur:function(){} }; };
  window.addEventListener('blur', function(e){ e.stopImmediatePropagation(); }, true);
  var _nk = 0;
  function nuke(){
    try {
      document.querySelectorAll('[id*="pop"],[id*="overlay"],[class*="pop"],[class*="ad-wrap"]').forEach(function(el){
        if(parseInt(getComputedStyle(el).zIndex||0)>999) el.remove();
      });
      document.querySelectorAll('iframe[src]').forEach(function(f){
        if(/(popads|popcash|exoclick|adsterra|propellerads|monetag)/.test(f.src)) f.remove();
      });
    }catch(e){}
    if(_nk++<20) setTimeout(nuke,600);
  }
  document.addEventListener('DOMContentLoaded', nuke);
  setTimeout(nuke, 300);

  function encode(url){
    try{ return cur+'/ocho/'+btoa(unescape(encodeURIComponent(url))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=/g,''); }
    catch(e){ return null; }
  }
  function shouldProxy(s){
    if(!s) return false;
    if(s.startsWith('/ocho/')) return false;
    if(s.startsWith('data:') || s.startsWith('blob:')) return false;
    if(s.includes(cur)) return false;
    return s.startsWith('http') || s.startsWith('//') || s.startsWith('/');
  }
  function toAbs(s){
    if(s.startsWith('//')) return 'https:'+s;
    if(s.startsWith('/')) return tgt+s;
    if(!s.startsWith('http')) return tgt+'/'+s;
    return s;
  }

  // Intercept fetch
  var _f = window.fetch;
  var _fl = new Set();
  window.fetch = function(input, opts){
    var s = typeof input==='string'?input:(input&&input.url)||'';
    if(!shouldProxy(s)) return _f(input, opts);
    if(_fl.has(s)) return Promise.reject(new Error('loop'));
    var p = encode(toAbs(s));
    if(!p) return _f(input, opts);
    _fl.add(s);
    return _f(p, opts).finally(function(){ _fl.delete(s); });
  };

  // Intercept XHR constructor (catches HLS.js on main thread)
  var NativeXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function(){
    var x = new NativeXHR();
    var _o = x.open.bind(x);
    x.open = function(m, url){
      if(typeof url==='string' && shouldProxy(url)){
        var p = encode(toAbs(url));
        if(p) url = p;
      }
      return _o.apply(this, [m, url].concat(Array.prototype.slice.call(arguments,2)));
    };
    return x;
  };
  Object.setPrototypeOf(window.XMLHttpRequest, NativeXHR);
  Object.setPrototypeOf(window.XMLHttpRequest.prototype, NativeXHR.prototype);

  // Intercept video/audio src (main thread)
  function patchMedia(proto){
    var d = Object.getOwnPropertyDescriptor(proto,'src');
    if(!d||!d.set) return;
    Object.defineProperty(proto,'src',{
      get: d.get,
      set: function(v){
        if(typeof v==='string' && shouldProxy(v)){
          var p = encode(toAbs(v));
          if(p){ d.set.call(this,p); return; }
        }
        d.set.call(this,v);
      },
      configurable: true
    });
  }
  try { patchMedia(HTMLVideoElement.prototype); } catch(e){}
  try { patchMedia(HTMLAudioElement.prototype); } catch(e){}
  try { patchMedia(HTMLSourceElement.prototype); } catch(e){}

  // Intercept setAttribute for src on media elements
  var _sa = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(n, v){
    if(n==='src' && (this instanceof HTMLVideoElement || this instanceof HTMLAudioElement || this instanceof HTMLSourceElement)){
      if(typeof v==='string' && shouldProxy(v)){
        var p = encode(toAbs(v));
        if(p){ _sa.call(this,n,p); return; }
      }
    }
    _sa.call(this,n,v);
  };

  // Block service worker hijacking
  try { Object.defineProperty(navigator,'serviceWorker',{get:()=>undefined,configurable:false}); } catch(e){}
})();
</script>`;
}

// ── HEADER SPOOFING FOR CINEMAOS PROXY DOMAINS ────────────────────────────────
function getSpoofHeaders(urlObj) {
  const host = urlObj.hostname.toLowerCase();
  if (!host.includes('cinemaos') && !host.includes('huhululu') &&
      !host.includes('digitalcinema') && !host.includes('m3u8-proxy')) return null;

  const ref = urlObj.searchParams.get('referer') || urlObj.searchParams.get('ref');
  const org = urlObj.searchParams.get('origin');
  if (ref) { try { return { referer: ref, origin: new URL(ref).origin }; } catch(e){} }
  if (org) { try { return { referer: org+'/', origin: org }; } catch(e){} }
  return { referer: 'https://cinemaos.tech/', origin: 'https://cinemaos.tech' };
}

// ── HTML REWRITER ─────────────────────────────────────────────────────────────
function rewriteHtmlResponse(response, targetUrl) {
  const origin   = new URL(targetUrl).origin;
  const injected = buildInjectedScript(origin);

  return new HTMLRewriter()
    .on('meta[http-equiv="Content-Security-Policy"]', new MetaRemover())
    .on('meta[name="referrer"]', new MetaRemover())
    .on('script[src]', new ScriptRemover())
    .on('head', new HeadInjector(injected))
    .on('[src]',    new AttributeRewriter('src',    origin))
    .on('[href]',   new AttributeRewriter('href',   origin))
    .on('[action]', new AttributeRewriter('action', origin))
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
        const dir = base.pathname.substring(0, base.pathname.lastIndexOf('/')+1);
        abs = base.origin + dir + t;
      }
      return '/ocho/' + encodeProxyUrl(abs);
    } catch(e) { return line; }
  }).join('\n');
}

async function rewriteJs(text) {
  return text.replace(
    /(["'`])(https?:\/\/[^"'`\s]+?\.(m3u8|mp4|ts|key|vtt|srt)[^"'`\s]*)(["'`])/gi,
    (match, q1, url, ext, q2) => {
      try { return q1 + '/ocho/' + encodeProxyUrl(url) + q2; } catch(e) { return match; }
    }
  );
}

// ── CORS HEADERS ──────────────────────────────────────────────────────────────
const CORS = {
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
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept':          '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'identity',
      'Referer':         referer,
      'Origin':          origin,
      'Sec-Fetch-Dest':  'empty',
      'Sec-Fetch-Mode':  'cors',
      'Sec-Fetch-Site':  'cross-site',
      'Sec-CH-UA':       '"Google Chrome";v="124", "Not:A-Brand";v="8"',
      'Sec-CH-UA-Mobile':'?0',
      'Sec-CH-UA-Platform': '"Windows"',
    });

    const cookie = request.headers.get('cookie');
    const range  = request.headers.get('range');
    if (cookie) headers.set('cookie', cookie);
    if (range)  headers.set('range', range);

    const init = { method: request.method, headers, redirect: 'follow' };
    if (['POST','PUT','PATCH'].includes(request.method)) init.body = request.body;

    const upstream = await fetch(targetUrl, init);
    const ct = upstream.headers.get('content-type') || 'application/octet-stream';

    const resHeaders = new Headers(CORS);
    resHeaders.set('Content-Type', ct);
    for (const h of ['content-length','content-range','accept-ranges','cache-control','etag','last-modified']) {
      const v = upstream.headers.get(h);
      if (v) resHeaders.set(h, v);
    }

    if (ct.includes('text/html')) {
      return rewriteHtmlResponse(
        new Response(upstream.body, { status: upstream.status, headers: resHeaders }),
        targetUrl
      );
    }
    if (ct.includes('application/x-mpegURL') || ct.includes('application/vnd.apple.mpegurl') || targetUrl.includes('.m3u8')) {
      const text = await upstream.text();
      return new Response(await rewriteM3u8(text, targetUrl), { status: upstream.status, headers: resHeaders });
    }
    if (ct.includes('application/json') || ct.includes('javascript')) {
      const text = await upstream.text();
      resHeaders.set('Content-Type', ct);
      return new Response(await rewriteJs(text), { status: upstream.status, headers: resHeaders });
    }

    return new Response(upstream.body, { status: upstream.status, headers: resHeaders });

  } catch(err) {
    return new Response(JSON.stringify({ error: 'Proxy error', message: err.message, url: targetUrl }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...Object.fromEntries(Object.entries(CORS)) }
    });
  }
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event));
});

async function handleRequest(request, event) {
  const url      = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS });
  }

  // ── /ocho/ proxy ──
  if (pathname.startsWith('/ocho/')) {
    const encoded = pathname.slice('/ocho/'.length);
    try {
      let targetUrl = decodeProxyUrl(encoded);
      if (url.search) targetUrl += url.search;
      return await handleProxy(targetUrl, request);
    } catch(e) {
      return new Response(JSON.stringify({ error: 'Bad URL encoding', message: e.message }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...Object.fromEntries(Object.entries(CORS)) }
      });
    }
  }

  // ── Media Service Worker ──
  // This SW intercepts ALL network requests from /ocho/ pages at the network layer,
  // including HLS.js requests from Web Worker threads — fixing TV show playback.
  if (pathname === '/media-sw.js') {
    return new Response(MEDIA_SW_CODE, {
      headers: {
        'Content-Type': 'application/javascript',
        'Service-Worker-Allowed': '/',
        'Cache-Control': 'no-cache',
      }
    });
  }

  // ── Stub SW ──
  if (pathname === '/sw.js') {
    return new Response(
      `self.addEventListener('install',()=>self.skipWaiting());
       self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister()));
       self.addEventListener('fetch',e=>e.respondWith(fetch(e.request)));`,
      { headers: { 'Content-Type': 'application/javascript' } }
    );
  }

  // ── Static assets ──
  try {
    return await getAssetFromKV(event);
  } catch(e) {
    const referer = request.headers.get('referer') || '';
    if (referer.includes('/ocho/')) {
      try {
        const refUrl  = new URL(referer);
        const parts   = refUrl.pathname.split('/ocho/');
        if (parts.length > 1) {
          const enc    = parts[1].split('?')[0];
          const ref    = decodeProxyUrl(enc);
          const refObj = new URL(ref);
          const fixed  = pathname.startsWith('/')
            ? refObj.origin + pathname + url.search
            : refObj.origin + '/' + pathname + url.search;
          return await handleProxy(fixed, request);
        }
      } catch(e2) {}
    }
    return new Response('Not Found', { status: 404 });
  }
}
