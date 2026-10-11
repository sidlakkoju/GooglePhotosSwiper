import {pairPage} from './pair-page.mjs';
import {syncRequest} from './sync.mjs';
import userscript from '../../userscript/photoswiper.user.js';

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname === '/pair') return pairPage(request);
    if (new URL(request.url).pathname.startsWith('/api/')) return syncRequest(request, env);
    if (new URL(request.url).pathname !== '/photoswiper.user.js') {
      return new Response(request.method === 'HEAD' ? null : 'Not found', {status: 404});
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {status: 405, headers: {Allow: 'GET, HEAD'}});
    }
    return new Response(request.method === 'HEAD' ? null : userscript, {
      headers: {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'max-age=300'
      }
    });
  }
};
