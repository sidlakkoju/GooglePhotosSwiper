import {googleAuthRequest} from './google-auth.mjs';
import {pairPage} from './pair-page.mjs';
import {syncRequest} from './sync.mjs';
import loader from '../../userscript/photoswiper-loader.user.js';
import release from '../generated/release.mjs';
import appBundle from '../../userscript/photoswiper-app.user.js';
import userscript from '../../userscript/photoswiper.user.js';

export const requiredLoaderVersion='1.0.0';

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/auth/')) return googleAuthRequest(request, env);
    if (new URL(request.url).pathname === '/pair') return pairPage(request);
    if (new URL(request.url).pathname.startsWith('/api/')) return syncRequest(request, env);
    const path=new URL(request.url).pathname;
    if(path==='/app.js'||path==='/version'){
      const headers={'Content-Type':path==='/app.js'?'text/javascript; charset=utf-8':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'X-Photoswiper-Version, X-Photoswiper-Required-Loader-Version','X-Photoswiper-Required-Loader-Version':requiredLoaderVersion,'X-Photoswiper-Version':/^\/\/ @version (\S+)$/m.exec(appBundle)[1]};
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, HEAD, OPTIONS'}});
      if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...headers,Allow:'GET, HEAD, OPTIONS'}});
      const code=appBundle.slice(appBundle.indexOf('// ==/UserScript==')+'// ==/UserScript=='.length).trimStart();
      return new Response(request.method==='HEAD'?null:path==='/app.js'?code:JSON.stringify({version:headers['X-Photoswiper-Version'],requiredLoaderVersion}),{headers});
    }
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
