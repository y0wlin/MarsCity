import fs from 'fs'; import { PNG } from 'pngjs';
const dir = '../参考图/03-control/';
const load=f=>PNG.sync.read(fs.readFileSync(dir+f));
const B=load('built-density.png'),E=load('emission.png'),W=load('water.png'),P=load('province-ID.png');
function hist(img,name){ const h=new Array(16).fill(0); let landN=0; for(let i=0;i<img.width*img.height;i++){ if(W.data[i*4]>127) continue; landN++; h[img.data[i*4]>>4]++; } console.log(name,'land hist(16 bins %):',h.map(v=>(v/landN*100).toFixed(1)).join(' ')); }
hist(B,'density'); hist(E,'emission');
// water hist of density/emission
{ let s=0,n=0,se=0; for(let i=0;i<W.width*W.height;i++){ if(W.data[i*4]>127){ s+=B.data[i*4]; se+=E.data[i*4]; n++; } } console.log('water mean density',(s/n).toFixed(1),'emis',(se/n).toFixed(1)); }
// coast scan: for lon in 90..150 step 2, find northernmost water lat in east sea
for (let lon=50; lon<=165; lon+=5){ const x=Math.floor((lon+180)/360*2048); let north=null,south=null; for(let y=0;y<1024;y++){ if(W.data[(y*2048+x)*4]>127){ if(north===null) north=y; south=y; } } const f=y=>y===null?'-':(90-(y+0.5)*180/1024).toFixed(1); const pn = north===null?'-':P.data[((north-3)*2048+x)*4]; console.log('lon',lon,'east-sea water lat N',f(north),'S',f(south),'prov north of coast',pn); }
for (let lon=-115; lon<=-40; lon+=5){ const x=Math.floor((lon+180)/360*2048); let north=null,south=null; for(let y=0;y<1024;y++){ if(W.data[(y*2048+x)*4]>127){ if(north===null) north=y; south=y; } } const f=y=>y===null?'-':(90-(y+0.5)*180/1024).toFixed(1); const ps = south===null?'-':P.data[((south+3)*2048+x)*4]; console.log('lon',lon,'west-sea water lat N',f(north),'S',f(south),'prov south of coast',ps); }
