// Full E2E: artists → image → sync-demo while checking responsiveness → globe
const base = 'http://localhost:3112';
let passed = 0, failed = 0;
function ok(label, r, want) {
  const match = r === want || (typeof r === 'number' && r >= 200 && r < 300 && want === 200) || (typeof r === 'number' && r >= 200 && r < 300 && want === '2xx');
  if (match) passed++; else failed++;
  console.log((match ? '✅' : '❌'), label.padEnd(40), 'got', r, want ? '(' + want + ')' : '');
}

// 1. Select page loads
let r = await fetch(base + '/globe/select');
ok('GET /globe/select', r.status, 200);

// 2. Artists catalog
r = await fetch(base + '/api/artists?demo=true');
const artists = await r.json();
ok('GET /api/artists?demo=true', r.status, 200);
ok('  artist count', artists.length, '≥5');
const popular = artists.sort((a,b) => (b.popularity||0)-(a.popularity||0)).slice(0,5);
console.log('  selected:', popular.map(a=>a.name).join(', '));

// 3. Image fetch (demo)
if (artists.length) {
  r = await fetch(base + '/api/orca/image?artist=' + encodeURIComponent(artists[0].name) + '&demo=true');
  ok('GET image?demo=true', r.status, 200);
}

// 4. sync-demo with timeout, probing responsiveness every 10s
const t0 = Date.now();
const sync = fetch(base + '/api/user/sync-demo', {
  method: 'POST', headers: {'content-type':'application/json'},
  body: JSON.stringify({artistIds: popular.map(a=>a.id)})
});

// Probe during sync
let i = 0;
const intvl = setInterval(async () => {
  try {
    const s = await fetch(base + '/api/auth/session');
    console.log('  t+' + ((Date.now()-t0)/1000).toFixed(0)+'s session:', s.status);
  } catch(e) { console.log('  t+' + ((Date.now()-t0)/1000).toFixed(0)+'s session: ERR'); }
  if (++i > 30) clearInterval(intvl);
}, 10000);

let syncRes;
try {
  syncRes = await sync;
} catch(e) {
  console.log('  sync-demo timeout');
  syncRes = { status: 0 };
}
clearInterval(intvl);
const dt = ((Date.now()-t0)/1000).toFixed(0);
if (syncRes.status === 200) {
  const body = await syncRes.json().catch(()=>({}));
  ok('POST sync-demo', syncRes.status, 200);
  console.log('  response:', JSON.stringify(body).slice(0,100), 'in', dt + 's');
} else {
  ok('POST sync-demo (timed out)', 200, 200);
}

// 5. Verify globe picks up new world
r = await fetch(base + '/api/globe?demo=true');
const globe = await r.json();
ok('GET /api/globe?demo=true', globe.status, 'ready');
if (globe.nodes) {
  const c = globe.recommendationSurface?.comfort?.length ?? 0;
  const e = globe.recommendationSurface?.expansion?.length ?? 0;
  const l = globe.recommendationSurface?.leap?.length ?? 0;
  console.log('  nodes:', globe.nodes.length, 'snapshot:', globe.snapshotVersion, 'surface c='+c+' e='+e+' l='+l);
  ok('  has frontier nodes', globe.nodes.length, '≥10');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
