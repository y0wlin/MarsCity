import fs from 'fs'; import { PNG } from 'pngjs';
const dir = '../参考图/03-control/';
function load(f){ const p = PNG.sync.read(fs.readFileSync(dir+f)); return p; }
for (const f of ['province-ID.png','zone-O.png','water.png','built-density.png','emission.png']) {
  const p = load(f); const {width:w,height:h,data:d} = p;
  const uniq = new Map(); let chDiff=0; let aMin=255;
  for (let i=0;i<w*h;i++){ const r=d[i*4],g=d[i*4+1],b=d[i*4+2],a=d[i*4+3]; if(r!==g||g!==b) chDiff++; aMin=Math.min(aMin,a); const k=r; uniq.set(k,(uniq.get(k)||0)+1); }
  const keys=[...uniq.keys()].sort((a,b)=>a-b);
  console.log(f, w+'x'+h, 'colorType', p.colorType, 'bitDepth', p.depth, 'nonGray', chDiff, 'alphaMin', aMin, 'uniqR', keys.length, keys.length<40? JSON.stringify(keys.map(k=>[k,uniq.get(k)])) : `min ${keys[0]} max ${keys[keys.length-1]}`);
}
// zone area fraction cos-weighted
{ const p=load('zone-O.png'); const {width:w,height:h,data:d}=p; let wo=0,wt=0; for(let y=0;y<h;y++){ const lat=(90-(y+0.5)*180/h)*Math.PI/180; const c=Math.cos(lat); for(let x=0;x<w;x++){ const v=d[(y*w+x)*4]; wt+=c; if(v>127) wo+=c; } } console.log('zone O fraction', (wo/wt*100).toFixed(6)+'%'); }
// province per zone & centroid
{ const p=load('province-ID.png'); const z=load('zone-O.png'); const wa=load('water.png'); const {width:w,height:h,data:d}=p; const stats={};
  for(let y=0;y<h;y++){ const lat=90-(y+0.5)*180/h; const c=Math.cos(lat*Math.PI/180); for(let x=0;x<w;x++){ const lon=-180+(x+0.5)*360/w; const id=d[(y*w+x)*4]; const zo=z.data[((y*2)*z.width+x*2)*4]>127; const water=wa.data[(y*w+x)*4]>127; const s=stats[id]||(stats[id]={area:0,o:0,water:0,sx:0,sy:0,sz:0,latMin:90,latMax:-90}); s.area+=c; if(zo)s.o+=c; if(water)s.water+=c; const lr=lat*Math.PI/180, lo=lon*Math.PI/180; s.sx+=c*Math.cos(lr)*Math.sin(lo); s.sy+=c*Math.sin(lr); s.sz+=c*Math.cos(lr)*Math.cos(lo); s.latMin=Math.min(s.latMin,lat); s.latMax=Math.max(s.latMax,lat);} }
  let tot=0; for(const k in stats) tot+=stats[k].area;
  for(const k of Object.keys(stats).sort((a,b)=>a-b)){ const s=stats[k]; const n=Math.hypot(s.sx,s.sy,s.sz); const clat=Math.asin(s.sy/n)*180/Math.PI, clon=Math.atan2(s.sx,s.sz)*180/Math.PI; console.log('prov',k,'area%',(s.area/tot*100).toFixed(2),'O%',(s.o/s.area*100).toFixed(1),'water%',(s.water/s.area*100).toFixed(1),'centroid',clat.toFixed(1),clon.toFixed(1),'lat',s.latMin.toFixed(1),s.latMax.toFixed(1)); }
}
// sample values at anchors
const anchors=[['OX1',105,8],['OX2',-105,-9],['OX3',-135,22],['OX4',45,72],['OX5',-45,-28],['OX6',-165,-65],['ZR1',118,22],['ZR2',-105,35],['ZR3',-15,22],['ZR4',165,8],['ZR5',105,-46],['ZR6',-105,-65]];
{ const P=load('province-ID.png'),Z=load('zone-O.png'),W=load('water.png'),B=load('built-density.png'),E=load('emission.png');
  const s=(img,lon,lat)=>{const x=Math.min(img.width-1,Math.floor((lon+180)/360*img.width)), y=Math.min(img.height-1,Math.floor((90-lat)/180*img.height)); return img.data[(y*img.width+x)*4];};
  for(const [n,lon,lat] of anchors) console.log(n,lon,lat,'prov',s(P,lon,lat),'zoneO',s(Z,lon,lat),'water',s(W,lon,lat),'dens',s(B,lon,lat),'emis',s(E,lon,lat));
}
