import {pairPage} from './pair-page.mjs';
import {syncRequest} from './sync.mjs';
import loader from '../../userscript/photoswiper-loader.user.js';
import release from '../generated/release.mjs';
import userscript from '../../userscript/photoswiper.user.js';

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname === '/pair') return pairPage(request);
    if (new URL(request.url).pathname.startsWith('/api/')) return syncRequest(request, env);
    const path=new URL(request.url).pathname;
    if (!['/photoswiper.user.js','/photoswiper-loader.user.js','/photoswiper-release.json'].includes(path)) {
      return new Response(request.method === 'HEAD' ? null : 'Not found', {status: 404});
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {status: 405, headers: {Allow: 'GET, HEAD'}});
    }
    return new Response(request.method === 'HEAD' ? null : path==='/photoswiper-release.json'?JSON.stringify(release):path==='/photoswiper-loader.user.js'?loader:userscript, {
      headers: {
        'Content-Type': path==='/photoswiper-release.json'?'application/json; charset=utf-8':'text/javascript; charset=utf-8',
        'Cache-Control': path==='/photoswiper-release.json'?'no-store':'max-age=300'
      }
    });
  }
};
