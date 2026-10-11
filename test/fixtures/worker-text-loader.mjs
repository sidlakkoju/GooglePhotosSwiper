import {readFile} from 'node:fs/promises';

const userscriptURL = new URL('../../userscript/photoswiper.user.js', import.meta.url).href;

export async function load(url, context, nextLoad) {
  if (url !== userscriptURL) return nextLoad(url, context);
  const source = await readFile(new URL(url), 'utf8');
  return {format: 'module', source: `export default ${JSON.stringify(source)};`, shortCircuit: true};
}
