export function fulfillVideo(route,body,contentType){
 const range=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||'');
 if(!range)return route.fulfill({status:200,contentType,headers:{'accept-ranges':'bytes'},body});
 const start=+range[1],end=Math.min(range[2]?+range[2]:body.length-1,body.length-1);
 return route.fulfill({status:206,contentType,headers:{'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${body.length}`},body:body.subarray(start,end+1)});
}
