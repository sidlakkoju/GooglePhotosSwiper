import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {problem} from './store.mjs';
export const ARCHIVE_MAX=1024*1024*1024+16*1024*1024;
const run=promisify(execFile),script=fileURLToPath(new URL('../scripts/trim-archive.py',import.meta.url));
export async function extractStoredMovie(archive,target,source){
 if(typeof source?.name!=='string'||!Number.isSafeInteger(source.size)||source.size<1||source.size>1024*1024*1024)throw problem(400,'Canonical original archive metadata is unsupported.');
 let result;
 try{result=await run('/usr/bin/python3',[script,archive,target,source.name,String(source.size)],{timeout:120000,maxBuffer:65536});}
 catch(error){let report;try{report=JSON.parse(error.stdout);}catch{}throw problem(409,report?.ok===false&&typeof report.error==='string'?report.error:'Original ZIP extraction failed. No file was accepted.');}
 let report;try{report=JSON.parse(result.stdout);}catch{throw problem(409,'Original ZIP extraction report is malformed.');}
 if(report.ok!==true||report.bytes!==source.size)throw problem(409,'Original ZIP extraction did not confirm the exact byte size.');return report;
}
