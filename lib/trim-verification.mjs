import {problem} from './store.mjs';
// Google's canonical Photos coordinates can be decimal degrees or E7 integers.
// Toolkit's location filter documents E7 values, latitude first. Decode a whole
// integer tuple only when its magnitude unambiguously exceeds degree values;
// never swap axes or accept out-of-range/fractional E7 encodings.
export function canonicalGoogleLocation(location){
 if(location===null)return null;
 if(!Array.isArray(location)||location.length!==2||!location.every(Number.isFinite))throw problem(400,'Canonical original location has an unsupported format.');
 let degrees=[...location];
 if(location.some(n=>Math.abs(n)>360)){
  if(!location.every(Number.isSafeInteger))throw problem(400,'Canonical original location has an unsupported E7 format.');
  degrees=location.map(n=>n/1e7);
 }
 if(Math.abs(degrees[0])>90||Math.abs(degrees[1])>180)throw problem(400,'Canonical original location has an unsupported format.');
 return degrees;
}
export function verifyRemoteMetadata(job,observed){
 if(!observed||observed.account!==job.account||observed.name!==job.name||observed.mediaKey===job.source.mediaKey)throw problem(409,'The generated crop identity does not match this job.');
 const source=job.source;let location;try{location=canonicalGoogleLocation(observed.location);}catch{throw problem(409,'Capture location could not be verified. The original remains unchanged.');}
 if((source.date===null)!==(observed.date===null)||source.date&&(!Number.isFinite(Date.parse(observed.date))||Math.abs(Date.parse(source.date)-Date.parse(observed.date))>1))throw problem(409,'Capture time was not preserved. Correct the replacement date in Google Photos, then retry verification.');
 if(source.timezoneOffset!==null&&source.timezoneOffset!==observed.timezoneOffset)throw problem(409,'Capture timezone was not preserved. The original remains unchanged.');
 if((source.location===null)!==(location===null)||source.location&&(!Array.isArray(location)||location.length!==2||location.some((n,i)=>!Number.isFinite(n)||Math.abs(n-source.location[i])>0.00001)))throw problem(409,'Capture location was not preserved. Correct the replacement place, then retry verification.');
 if(!Number.isFinite(observed.duration)||Math.abs(observed.duration-job.exportReport.duration)>.1||observed.width!==job.exportReport.width||observed.height!==job.exportReport.height)throw problem(409,'Uploaded clip metadata does not match the export.');
 return true;
}
