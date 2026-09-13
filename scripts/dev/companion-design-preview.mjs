import { createRequire } from "node:module";
import { mkdir, writeFile, cp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
const require = createRequire(`${process.cwd()}/package.json`);
const esbuild = require("esbuild");
const { chromium } = require("playwright");
const root = process.cwd();
const out = `${root}/.dev/companion-design-preview`;
// Standalone review harness: real presence/store, simulated conversation, no daemon connection.
await mkdir(out, { recursive: true });
const result = await esbuild.build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import i18n from 'i18next'; import {initReactI18next} from 'react-i18next'; import {CompanionPresence} from './src/companion/presence'; import {useCompanionStore} from './src/companion/store';
 i18n.use(initReactI18next).init({lng:'en',resources:{en:{translation:{companion:{micState:{listening:'Listening',thinking:'Thinking',speaking:'Speaking',idle:'Idle'},actions:{mute:'Mute',unmute:'Unmute',start:'Start Companion'},status:{muted:'Microphone muted',connecting:'Connecting…'}}}}}});
 const state=useCompanionStore.getState(); state.sessionStarted(); state.transcriptReceived({text:'How is the build going?',isFinal:true});
 globalThis.orbState=useCompanionStore;
 function App(){const [animated,setAnimated]=React.useState(true); return <div style={{padding:20,background:'#181B1A',border:'1px solid #252B2A',borderRadius:28,fontFamily:'system-ui',color:'#e9eeec',maxWidth:420,margin:'32px auto',boxShadow:'0 18px 60px #26305712'}}><div style={{fontSize:18,fontWeight:600}}>Companion</div><div style={{fontSize:12,color:'#A1A5A4',margin:'6px 0 20px'}}>Development host · My project</div><CompanionPresence animated={animated} onPress={()=>state.setMuted(!useCompanionStore.getState().isMuted)}/><p style={{fontSize:15,textAlign:'center',margin:'24px 0',color:'#A1A5A4'}}>How is the build going?</p><div style={{display:'flex',justifyContent:'center',gap:12,flexWrap:'wrap'}}>
 <button onClick={()=>{state.sessionStarted();state.transcriptReceived({text:'Check the build',isFinal:true})}}>Thinking</button>
 <button onClick={()=>{state.sessionStarted();state.companionAudioStarted();state.setSpeakingVolume(.7)}}>Speaking</button>
 <button onClick={()=>state.setMuted(!useCompanionStore.getState().isMuted)}>Mute / unmute</button>
 <button onClick={()=>state.sessionReconnecting()}>Reconnect</button>
 <button onClick={()=>setAnimated(!animated)}>Toggle motion</button></div>
 <label style={{display:'block',marginTop:20}}>Simulated microphone <input aria-label="Microphone energy" type="range" min="0" max="1" step=".01" defaultValue="0" onChange={e=>state.setVolume(Number(e.target.value))}/></label>
 <p style={{fontSize:12,color:'#a1a5a4'}}>Design review · simulated session · no microphone or daemon access</p>
 <p>New local voice · Rosie</p><audio controls src="./rosie.wav" style={{width:'100%'}}/>
 <p>Previous local voice · Piper</p><audio controls src="./piper.wav" style={{width:'100%'}}/>
 </div>}
 createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: `${root}/apps/ui`,
    loader: "tsx",
  },
  write: false,
  bundle: true,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  mainFields: ["browser", "module", "main"],
  resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".js"],
  define: { global: "globalThis", "process.env.NODE_ENV": '"development"', __DEV__: "true" },
  alias: {
    "@": `${root}/apps/ui/src`,
    "react-native": "react-native-web",
    "react-native-svg": `${root}/node_modules/react-native-svg/lib/module/ReactNativeSVG.web.js`,
  },
  plugins: [
    {
      name: "actual-theme",
      setup(build) {
        build.onResolve({ filter: /^react-native-unistyles$/ }, () => ({
          path: "theme",
          namespace: "theme",
        }));
        build.onLoad({ filter: /.*/, namespace: "theme" }, () => ({
          contents: `import React from 'react'; import {darkTheme as theme} from '${root}/apps/ui/src/styles/theme'; export const StyleSheet={create:fn=>typeof fn==='function'?fn(theme):fn}; export const withUnistyles=(Component,map)=>props=>React.createElement(Component,{...map(theme),...props});`,
          loader: "js",
          resolveDir: root,
        }));
      },
    },
    {
      name: "motion-preference",
      setup(build) {
        build.onResolve({ filter: /^react-native-reanimated$/ }, () => ({
          path: "motion-preference",
          namespace: "preview",
        }));
        build.onLoad({ filter: /.*/, namespace: "preview" }, () => ({
          contents:
            'export function useReducedMotion(){ return matchMedia("(prefers-reduced-motion: reduce)").matches; }',
          loader: "js",
        }));
      },
    },
  ],
});
const js = result.outputFiles[0].text;
await writeFile(`${out}/preview.js`, js);
const html =
  '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Companion design review</title><style>button{background:#243047;color:#e9f4ff;border:1px solid #44526b;border-radius:20px;padding:10px;cursor:pointer}button:focus-visible{outline:2px solid #70efd8}</style><body style="margin:0;background:#101312"><div id="root"></div><script src="./preview.js"></script>';
await writeFile(`${out}/index.html`, html);
for (const voice of ["rosie", "piper"]) {
  await cp(
    `${root}/.dev/companion-polish-audio/${voice}/sample-0.wav`,
    `${out}/${voice}.wav`,
  ).catch(() => {});
}
const server = createServer(async (req, res) => {
  const assets = {
    "/preview.js": ["text/javascript", "preview.js"],
    "/rosie.wav": ["audio/wav", "rosie.wav"],
    "/piper.wav": ["audio/wav", "piper.wav"],
  };
  const asset = assets[req.url];
  try {
    res.setHeader("Content-Type", asset ? asset[0] : "text/html");
    res.end(asset ? await readFile(`${out}/${asset[1]}`) : html);
  } catch {
    res.statusCode = 404;
    res.end("Sample not generated; run the speech benchmark first.");
  }
});
await new Promise((r) => server.listen(0, "0.0.0.0", r));
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.stack);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`, {
    waitUntil: "networkidle",
  });
  await page.getByText("Listening", { exact: true }).waitFor();
  await page.screenshot({ path: `${out}/thinking.png` });
  const first = await page
    .locator('[data-testid="companion-orb-flow"]')
    .evaluate((e) => getComputedStyle(e).transform);
  await page.evaluate(() => orbState.getState().setVolume(0.9));
  await page.waitForTimeout(200);
  const scale = await page
    .locator('[data-testid="companion-input-level"]')
    .evaluate((e) => getComputedStyle(e).transform);
  await page.screenshot({ path: `${out}/input.png` });
  const next = await page
    .locator('[data-testid="companion-orb-flow"]')
    .evaluate((e) => getComputedStyle(e).transform);
  if (first === next) throw Error("Sphere did not flow");
  await page.locator('[data-testid="companion-mic-orb"]').click();
  await page.getByText("Microphone muted", { exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('[data-testid="companion-art-mono-surface"]'))
        .opacity === "1",
  );
  await page.screenshot({ path: `${out}/muted.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `${out}/desktop.png` });
  if (errors.length) throw Error(errors.join("\n"));
  console.log(JSON.stringify({ out, first, next, scale, errors }));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
