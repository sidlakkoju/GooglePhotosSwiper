export function pairingQR(value) {
 const bytes=new TextEncoder().encode(value);
 if(bytes.length>84)throw Error('Pairing URL too long');
 const bits=[],push=(value,length)=>{for(let i=length-1;i>=0;i--)bits.push(value>>>i&1);};
 push(4,4);push(bytes.length,8);for(const byte of bytes)push(byte,8);
 push(0,Math.min(4,688-bits.length));while(bits.length%8)bits.push(0);
 const data=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((a,b)=>a*2+b,0));
 while(data.length<86)data.push(data.length%2===Math.ceil(bits.length/8)%2?236:17);
 const multiply=(a,b)=>{let result=0;for(let i=0;i<8;i++){if(b&1)result^=a;b>>>=1;a<<=1;if(a&256)a^=285;}return result;};
 let generator=[1],power=1;
 for(let i=0;i<24;i++){const next=Array(generator.length+1).fill(0);generator.forEach((v,j)=>{next[j]^=v;next[j+1]^=multiply(v,power);});generator=next;power=multiply(power,2);}
 const blocks=[data.slice(0,43),data.slice(43)],parity=blocks.map(block=>{const remainder=[...block,...Array(24).fill(0)];for(let i=0;i<43;i++){const factor=remainder[i];for(let j=0;j<generator.length;j++)remainder[i+j]^=multiply(generator[j],factor);}return remainder.slice(43);});
 const stream=[];for(let i=0;i<43;i++)for(const block of blocks)pushByte(block[i]);for(let i=0;i<24;i++)for(const block of parity)pushByte(block[i]);
 function pushByte(byte){for(let i=7;i>=0;i--)stream.push(byte>>>i&1);}
 const size=37,matrix=Array.from({length:size},()=>Array(size).fill(false)),reserved=Array.from({length:size},()=>Array(size).fill(false));
 const set=(x,y,dark)=>{if(x>=0&&y>=0&&x<size&&y<size){matrix[y][x]=!!dark;reserved[y][x]=true;}};
 for(const [cx,cy] of [[3,3],[33,3],[3,33]])for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const distance=Math.max(Math.abs(dx),Math.abs(dy));set(cx+dx,cy+dy,distance!==2&&distance!==4);}
 for(let i=8;i<size-8;i++){set(i,6,i%2===0);set(6,i,i%2===0);}
 for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(30+dx,30+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
 const format=0x5412;
 for(let i=0;i<=5;i++)set(8,i,format>>>i&1);
 set(8,7,format>>>6&1);set(8,8,format>>>7&1);set(7,8,format>>>8&1);
 for(let i=9;i<15;i++)set(14-i,8,format>>>i&1);
 for(let i=0;i<8;i++)set(size-1-i,8,format>>>i&1);
 for(let i=8;i<15;i++)set(8,size-15+i,format>>>i&1);
 set(8,size-8,true);
 let index=0,up=true;
 for(let right=size-1;right>=1;right-=2){if(right===6)right=5;for(let vertical=0;vertical<size;vertical++){const y=up?size-1-vertical:vertical;for(let offset=0;offset<2;offset++){const x=right-offset;if(!reserved[y][x])matrix[y][x]=!!((stream[index++]||0)^((x+y)%2===0));}}up=!up;}
 return matrix;
}
export function renderPairingQR(document,value) {
 const matrix=pairingQR(value),canvas=document.createElement('canvas');canvas.width=canvas.height=270;
 const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,270,270);context.fillStyle='black';
 matrix.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)context.fillRect((x+4)*6,(y+4)*6,6,6);}));
 canvas.setAttribute('aria-label','Scan to pair another device');return canvas;
}
