const clusterID='1f43b675';
function elementLength(bytes,index){let width=1,mask=0x80;while(width<8&&!(bytes[index]&mask)){mask>>=1;width++;}let value=bytes[index]&(mask-1);for(let offset=1;offset<width;offset++)value=value*256+bytes[index+offset];return [value,width];}
function idWidth(bytes,index){let width=1,mask=0x80;while(width<4&&!(bytes[index]&mask)){mask>>=1;width++;}return width;}
export function splitWebM(bytes,secondsPerSegment=5){
 let index=0;const headerID=idWidth(bytes,0),[headerSize,headerWidth]=elementLength(bytes,headerID);index=headerID+headerWidth+headerSize;
 const segmentID=idWidth(bytes,index),[,segmentWidth]=elementLength(bytes,index+segmentID);index+=segmentID+segmentWidth;
 const clusters=[];let initEnd=0;
 while(index<bytes.length){
  const width=idWidth(bytes,index),id=bytes.subarray(index,index+width).toString('hex'),[size,sizeWidth]=elementLength(bytes,index+width),end=index+width+sizeWidth+size;
  if(id===clusterID){if(!initEnd)initEnd=index;clusters.push([index,end]);}
  index=end;
 }
 const segments=[];
 for(let start=0;start<clusters.length;start+=secondsPerSegment)segments.push(bytes.subarray(clusters[start][0],clusters[Math.min(clusters.length,start+secondsPerSegment)-1][1]));
 return {init:bytes.subarray(0,initEnd),segments,seconds:clusters.length};
}
export function dashManifest({seconds,segments,base='https://rr1---sn-test.googlevideo.com/videoplayback/',representations=[{id:'242',width:426,height:240},{id:'243',width:640,height:360}],secondsPerSegment=5}){
 const durations=segments.map((_,index)=>Math.min(secondsPerSegment,seconds-index*secondsPerSegment)*1000);
 const timeline=durations.map(value=>`<S d="${value}"/>`).join('');
 const list=segments.map((_,index)=>`<SegmentURL media="sq/${index+1}/dur/${(durations[index]/1000).toFixed(3)}"/>`).join('');
 return `<?xml version="1.0" encoding="UTF-8"?>\n<MPD xmlns="urn:mpeg:DASH:schema:MPD:2011" minBufferTime="PT1.500S" profiles="urn:mpeg:dash:profile:isoff-main:2011" type="static" mediaPresentationDuration="PT${seconds}.000S"><Period><AdaptationSet id="0" mimeType="video/webm" subsegmentAlignment="true"><Role schemeIdUri="urn:mpeg:DASH:role:2011" value="main"/><SegmentList startNumber="0" timescale="1000"><SegmentTimeline>${timeline}</SegmentTimeline></SegmentList>${representations.map(({id,width,height})=>`<Representation id="${id}" codecs="vp8" width="${width}" height="${height}" startWithSAP="1" maxPlayoutRate="1" bandwidth="${width*1000}" frameRate="30"><BaseURL>${base}id/${id}/source/photos/expire/1/ip/0.0.0.0/</BaseURL><SegmentList><Initialization sourceURL="sq/0"/>${list}</SegmentList></Representation>`).join('')}</AdaptationSet></Period></MPD>\n`;
}
export function dashSegment(pathname,split){
 const match=pathname.match(/\/id\/([^/]+)\/.*\/sq\/(\d+)/);if(!match)return null;
 const number=+match[2];return {id:match[1],number,body:number===0?split.init:split.segments[number-1]||null};
}
