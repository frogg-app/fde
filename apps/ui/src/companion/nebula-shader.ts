/** Approved Companion nebula. Keep website's vendored copy in sync. */
export const nebulaDefaults = {
  density: 0.65,
  speed: 0.3,
  cyan: 0.3,
  bloom: 0.55,
  energy: 0.25,
};
export const nebulaShader = `
precision highp float;
uniform vec2 resolution;
uniform vec3 seed,primary,secondary;
uniform float time,density,cyan,bloom,energy,muted,motion;
float hash(vec3 p){p=fract((p+seed)*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+vec3(3.1,1.7,2.4);a*=.5;}return v;}
vec4 nebula(vec2 point){
 vec2 uv=(point-.5*resolution)/min(resolution.x,resolution.y)*2.;
 float t=time*.34;
 float radius=.70;
 uv/=1.+energy*.065*motion;
 vec3 col=vec3(0.);
 float r=length(uv);
 float halo=exp(-max(r-radius,0.)*13.)*smoothstep(.3,.8,r);
 col+=primary*vec3(.098,.08,.15)*halo*.24*bloom;
 vec3 sum=vec3(0.);float alpha=0.;
 for(int i=0;i<28;i++){
  float z=-.85+float(i)*.062;
  vec3 p=vec3(uv,z);
  float turn=t*.25;
  mat2 rotation=mat2(cos(turn),-sin(turn),sin(turn),cos(turn));
  p.xy=rotation*p.xy;
  vec3 drift=vec3(sin(t*.31),sin(t*.23),sin(t*.19))*.12;
  vec3 curl=vec3(
   sin(p.y*5.+t*1.8)+sin(p.z*6.-t*1.3),
   sin(p.z*5.+t*1.5)+sin(p.x*6.-t*1.7),
   sin(p.x*5.+t*1.6)+sin(p.y*6.-t*1.4)
  )*.075;
  float edgeNoise=fbm((p+curl)*3.4+drift);
  float boundary=radius+(edgeNoise-.46)*.44;
  float sphere=1.-smoothstep(boundary*.69,boundary+.105,length(p));
  if(sphere>.001){
   float angle=z*.8;mat2 rot=mat2(cos(angle),-sin(angle),sin(angle),cos(angle));
   p.xy=rot*p.xy;
   vec3 q=(p+curl)*2.15+drift;
   float warp=fbm(q+vec3(sin(t*.27)*.10,0.,0.));
   float n=fbm(q+vec3(warp*2.4,-warp*1.8,warp)+vec3(0.,0.,sin(t*.21)*.10));
   float filament=fbm(q*1.65+vec3(n*3.)+vec3(sin(t*1.1),cos(t*.9)-1.,sin(t*1.3))*.4);
   float d=smoothstep(.29+(1.-density)*.18,.76,n)*sphere*.19;
   float vein=pow(max(0.,1.-abs(n-.52)*8.),3.)*filament;
   float hue=smoothstep(.25,.76,p.x*.35+p.y*.4+filament*.6+cyan*.55);
   vec3 purple=mix(primary*vec3(.288,.167,.55),primary,filament);
   vec3 light=mix(purple,secondary,hue);
   light*=(.45+vein*(2.8+bloom*3.))*(1.+energy*1.65);
   sum+=(1.-alpha)*light*d;
   alpha+=(1.-alpha)*d*.83;
  }
 }
 col+=sum*1.65;

 col=mix(col,vec3(dot(col,vec3(.2126,.7152,.0722)))*.65,muted);
 col=1.-exp(-col*1.22);
 return vec4(col, clamp(max(max(col.r,col.g),col.b),0.,1.));
}`;
export const nebulaFragmentShader = `${nebulaShader}
void main(){gl_FragColor=nebula(gl_FragCoord.xy);}`;
export const nebulaSkiaShader =
  nebulaShader
    .replace("precision highp float;", "")
    .replace(/\bvec([234])\b/g, "float$1")
    .replace(/\bmat2\b/g, "float2x2") +
  "\nhalf4 main(float2 point){return nebula(float2(point.x,resolution.y-point.y));}";

export function createNebulaSeed(): [number, number, number] {
  return [Math.random() * 128, Math.random() * 128, Math.random() * 128];
}

export interface NebulaPalette {
  primary: string;
  secondary: string;
}
export const defaultNebulaPalette: NebulaPalette = {
  primary: "#A826FF",
  secondary: "#06E0FF",
};
export function nebulaRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}
