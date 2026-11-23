module.exports=[93695,(e,t,r)=>{t.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},18622,(e,t,r)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},56704,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},32319,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},70406,(e,t,r)=>{t.exports=e.x("next/dist/compiled/@opentelemetry/api",()=>require("next/dist/compiled/@opentelemetry/api"))},47286,e=>{"use strict";var t=e.i(46822),r=e.i(61736),n=e.i(77248),a=e.i(14297),s=e.i(82901),o=e.i(89052),i=e.i(55251),l=e.i(53765),c=e.i(14707),d=e.i(92700),u=e.i(50973),p=e.i(75792),h=e.i(2780),v=e.i(85039),f=e.i(59113),x=e.i(93695);e.i(48225);var g=e.i(53057);let R=String.raw`const CACHE_NAME = "top-fleet-static-v1";
const STATIC_EXTENSIONS = /\.(css|js|png|jpg|jpeg|svg|ico|webmanifest)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([
        "/manifest.webmanifest",
        "/favicon.ico",
        "/top-logo-full.jpg",
        "/pwa-icon-192.png",
        "/pwa-icon-512.png"
      ]).catch(() => undefined)
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate" || url.pathname.startsWith("/api/")) {
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || STATIC_EXTENSIONS.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);

        return cached || network;
      })
    );
  }
});`;e.s(["GET",0,function(){return new Response(R,{headers:{"Cache-Control":"no-store, no-cache, must-revalidate, proxy-revalidate","Content-Type":"application/javascript; charset=utf-8",Expires:"0",Pragma:"no-cache","Surrogate-Control":"no-store"}})},"dynamic",0,"force-dynamic"],99551);var m=e.i(99551);let E=new t.AppRouteRouteModule({definition:{kind:r.RouteKind.APP_ROUTE,page:"/service-worker/route",pathname:"/service-worker",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/frontend/src/app/service-worker/route.ts",nextConfigOutput:"",userland:m,...{}}),{workAsyncStorage:w,workUnitAsyncStorage:C,serverHooks:y}=E;async function A(e,t,n){n.requestMeta&&(0,a.setRequestMeta)(e,n.requestMeta),E.isDev&&(0,a.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let R="/service-worker/route";R=R.replace(/\/index$/,"")||"/";let m=await E.prepare(e,t,{srcPage:R,multiZoneDraftMode:!1});if(!m)return t.statusCode=400,t.end("Bad Request"),null==n.waitUntil||n.waitUntil.call(n,Promise.resolve()),null;let{buildId:w,deploymentId:C,params:y,nextConfig:A,parsedUrl:k,isDraftMode:T,prerenderManifest:N,routerServerContext:b,isOnDemandRevalidate:q,revalidateOnlyGenerated:S,resolvedPathname:_,clientReferenceManifest:P,serverActionsManifest:O}=m,H=(0,i.normalizeAppPath)(R),j=!!(N.dynamicRoutes[H]||N.routes[_]),I=async()=>((null==b?void 0:b.render404)?await b.render404(e,t,k,!1):t.end("This page could not be found"),null);if(j&&!T){let e=!!N.routes[_],t=N.dynamicRoutes[H];if(t&&!1===t.fallback&&!e){if(A.adapterPath)return await I();throw new x.NoFallbackError}}let M=null;!j||E.isDev||T||(M="/index"===(M=_)?"/":M);let U=!0===E.isDev||!j,D=j&&!U;O&&P&&(0,o.setManifestsSingleton)({page:R,clientReferenceManifest:P,serverActionsManifest:O});let $=e.method||"GET",L=(0,s.getTracer)(),F=L.getActiveScopeSpan(),K=!!(null==b?void 0:b.isWrappedByNextServer),W=!!(0,a.getRequestMeta)(e,"minimalMode"),B=(0,a.getRequestMeta)(e,"incrementalCache")||await E.getIncrementalCache(e,A,N,W);null==B||B.resetRequestCache(),globalThis.__incrementalCache=B;let G={params:y,previewProps:N.preview,renderOpts:{experimental:{authInterrupts:!!A.experimental.authInterrupts},cacheComponents:!!A.cacheComponents,supportsDynamicResponse:U,incrementalCache:B,cacheLifeProfiles:A.cacheLife,waitUntil:n.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,r,n,a)=>E.onRequestError(e,t,n,a,b)},sharedContext:{buildId:w,deploymentId:C}},X=new l.NodeNextRequest(e),V=new l.NodeNextResponse(t),z=c.NextRequestAdapter.fromNodeNextRequest(X,(0,c.signalFromNodeResponse)(t));try{let a,o=async e=>E.handle(z,G).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let r=L.getRootSpanAttributes();if(!r)return;if(r.get("next.span_type")!==d.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${r.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let n=r.get("next.route");if(n){let t=`${$} ${n}`;e.setAttributes({"next.route":n,"http.route":n,"next.span_name":t}),e.updateName(t),a&&a!==e&&(a.setAttribute("http.route",n),a.updateName(t))}else e.updateName(`${$} ${R}`)}),i=async a=>{var s,i;let l=async({previousCacheEntry:r})=>{try{if(!W&&q&&S&&!r)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let s=await o(a);e.fetchMetrics=G.renderOpts.fetchMetrics;let i=G.renderOpts.pendingWaitUntil;i&&n.waitUntil&&(n.waitUntil(i),i=void 0);let l=G.renderOpts.collectedTags;if(!j)return await (0,p.sendResponse)(X,V,s,G.renderOpts.pendingWaitUntil),null;{let e=await s.blob(),t=(0,h.toNodeOutgoingHttpHeaders)(s.headers);l&&(t[f.NEXT_CACHE_TAGS_HEADER]=l),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let r=void 0!==G.renderOpts.collectedRevalidate&&!(G.renderOpts.collectedRevalidate>=f.INFINITE_CACHE)&&G.renderOpts.collectedRevalidate,n=void 0===G.renderOpts.collectedExpire||G.renderOpts.collectedExpire>=f.INFINITE_CACHE?void 0:G.renderOpts.collectedExpire;return{value:{kind:g.CachedRouteKind.APP_ROUTE,status:s.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:r,expire:n}}}}catch(t){throw(null==r?void 0:r.isStale)&&await E.onRequestError(e,t,{routerKind:"App Router",routePath:R,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:D,isOnDemandRevalidate:q})},!1,b),t}},c=await E.handleResponse({req:e,nextConfig:A,cacheKey:M,routeKind:r.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:N,isRoutePPREnabled:!1,isOnDemandRevalidate:q,revalidateOnlyGenerated:S,responseGenerator:l,waitUntil:n.waitUntil,isMinimalMode:W});if(!j)return null;if((null==c||null==(s=c.value)?void 0:s.kind)!==g.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==c||null==(i=c.value)?void 0:i.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});W||t.setHeader("x-nextjs-cache",q?"REVALIDATED":c.isMiss?"MISS":c.isStale?"STALE":"HIT"),T&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let d=(0,h.fromNodeOutgoingHttpHeaders)(c.value.headers);return W&&j||d.delete(f.NEXT_CACHE_TAGS_HEADER),!c.cacheControl||t.getHeader("Cache-Control")||d.get("Cache-Control")||d.set("Cache-Control",(0,v.getCacheControlHeader)(c.cacheControl)),await (0,p.sendResponse)(X,V,new Response(c.value.body,{headers:d,status:c.value.status||200})),null};K&&F?await i(F):(a=L.getActiveScopeSpan(),await L.withPropagatedContext(e.headers,()=>L.trace(d.BaseServerSpan.handleRequest,{spanName:`${$} ${R}`,kind:s.SpanKind.SERVER,attributes:{"http.method":$,"http.target":e.url}},i),void 0,!K))}catch(t){if(t instanceof x.NoFallbackError||await E.onRequestError(e,t,{routerKind:"App Router",routePath:H,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:D,isOnDemandRevalidate:q})},!1,b),j)throw t;return await (0,p.sendResponse)(X,V,new Response(null,{status:500})),null}}e.s(["handler",0,A,"patchFetch",0,function(){return(0,n.patchFetch)({workAsyncStorage:w,workUnitAsyncStorage:C})},"routeModule",0,E,"serverHooks",0,y,"workAsyncStorage",0,w,"workUnitAsyncStorage",0,C],47286)}];

//# sourceMappingURL=%5Broot-of-the-server%5D__1bmin-e._.js.map