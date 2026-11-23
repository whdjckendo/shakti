import * as THREE from 'three';

/* ------------------------------------------------------------------
   Headphones -> music.
   Hover the headphones: "Wear them". Click: they fade away (you've put them
   on) and the camera turns to the monitor, which shows a music menu. Picking
   a track plays it through a hidden YouTube player; the room's ambient
   sound pauses while music plays. "Take them off" stops the music and the
   headphones come back.
------------------------------------------------------------------- */

const TRACKS = [
  { label: 'Lofi', id: 'sF80I-TQiW0' },
  { label: 'Jazz', id: 'ApHL4mVUln0' },
  { label: 'Rock', id: 'Aio0-hIsIW0' },
  { label: 'Blues', id: '6nYGb8CyHfg' },
  { label: 'EDM', id: '6MAzUT1YhWE' },
  { label: 'Synth', id: 'vNwYtllyt3Q' },
  { label: 'Rap', id: '5OaGBXAzFY0' },
  { label: 'Indian classical', id: '059QnVHmPxg' },
  { label: 'Western classical', id: 'js6zXgxk0cQ' },
  { label: 'My award winning audio film about a hard of hearing, deaf girl', id: 'GTsDt9JVkqk', wide: true },
];
const BLUE = '#002fa7';
const FONT = "'Lexend', system-ui, sans-serif";

// layout in the 1920 x 1080 screen space
const ROWS = (() => {
  const r = [];
  // every track but the last in two columns, the last (the audio film) full width below
  const x0 = 250, x1 = 990, w = 680, h = 86, y0 = 250, gap = 16;
  const n = TRACKS.length - 1, perCol = Math.ceil(n / 2);
  for (let i = 0; i < n; i++) {
    const col = i < perCol ? 0 : 1, row = col ? i - perCol : i;
    r.push({ i, x: col ? x1 : x0, y: y0 + row * (h + gap), w, h });
  }
  r.push({ i: n, x: x0, y: y0 + perCol * (h + gap) + 14, w: 1420, h: 110 });
  return r;
})();
const STOP = { id: 'stop', x: 1430, y: 96, w: 240, h: 76 };

export function initMusic(opts) {
  const { monitor, headphones, renderer, infoEntry } = opts;

  // ---- menu texture ----
  const cv = document.createElement('canvas');
  cv.width = 1920; cv.height = 1080;
  const g = cv.getContext('2d');
  const texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  let hoverId = null, playing = -1, status = '', worn = false;
  const round = (x, y, w, h, r) => {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  };
  function draw() {
    const bg = g.createLinearGradient(0, 0, 1920, 1080);
    bg.addColorStop(0, '#fbfbfd'); bg.addColorStop(1, '#e9edf6');
    g.fillStyle = bg; g.fillRect(0, 0, 1920, 1080);
    g.fillStyle = '#1b1b1f'; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = `300 76px ${FONT}`;
    g.fillText('What are we listening to?', 250, 150);
    // take-them-off pill
    if (playing >= 0) {
      const hot = hoverId === 'stop';
      round(STOP.x, STOP.y, STOP.w, STOP.h, 38);
      g.fillStyle = hot ? BLUE : 'rgba(0,47,167,.08)'; g.fill();
      g.lineWidth = 3; g.strokeStyle = BLUE; g.stroke();
      g.fillStyle = hot ? '#fff' : BLUE; g.font = `400 32px ${FONT}`; g.textAlign = 'center';
      g.fillText('take them off', STOP.x + STOP.w / 2, STOP.y + STOP.h / 2 + 2);
      g.textAlign = 'left';
    }
    for (const r of ROWS) {
      const on = playing === r.i, hot = hoverId === r.i;
      round(r.x, r.y, r.w, r.h, 26);
      g.fillStyle = on ? BLUE : hot ? 'rgba(0,47,167,.12)' : 'rgba(255,255,255,.75)';
      g.fill();
      g.lineWidth = 3; g.strokeStyle = on || hot ? BLUE : 'rgba(27,27,31,.18)'; g.stroke();
      g.fillStyle = on ? '#fff' : BLUE;
      g.font = `600 40px ${FONT}`;
      g.fillText(String(r.i + 1), r.x + 38, r.y + r.h / 2 + 2);
      g.fillStyle = on ? '#fff' : '#1b1b1f';
      const wide = TRACKS[r.i].wide;
      g.font = `${wide ? 300 : 400} ${wide ? 40 : 42}px ${FONT}`;
      g.fillText(TRACKS[r.i].label, r.x + 96, r.y + r.h / 2 + 2);
      if (on) {   // little equaliser
        g.fillStyle = '#fff';
        const t = performance.now() / 180;
        for (let k = 0; k < 4; k++) {
          const bh = 14 + 24 * Math.abs(Math.sin(t + k * 1.3));
          g.fillRect(r.x + r.w - 90 + k * 16, r.y + r.h / 2 + 22 - bh, 10, bh);
        }
      }
    }
    g.fillStyle = 'rgba(27,27,31,.55)'; g.font = `300 32px ${FONT}`;
    g.fillText(status || (playing >= 0 ? `Now playing: ${TRACKS[playing].label}` : 'Pick one. Esc to look around while it plays.'), 250, 1000);
    texture.needsUpdate = true;
  }
  draw();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);   // redraw once Lexend is in
  // keep the equaliser moving while the menu is up
  setInterval(() => { if (playing >= 0 && monitor.active) draw(); }, 120);

  // ---- YouTube player (hidden) ----
  const holder = document.createElement('div');
  holder.id = 'yt-holder';
  holder.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:.01;pointer-events:none;overflow:hidden;z-index:-1';
  const slot = document.createElement('div');
  holder.appendChild(slot);
  document.body.appendChild(holder);
  let player = null, ytReady = null;
  const loadYT = () => ytReady || (ytReady = new Promise((res) => {
    if (window.YT && window.YT.Player) return res();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev && prev(); res(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  }));
  loadYT();   // warm it up so the click starts music quickly

  const failed = new Set();
  function onError() {
    if (playing < 0) return;
    failed.add(playing);
    status = `${TRACKS[playing].label} can't play inside the site. Click it again to open it on YouTube.`;
    playing = -1;
    setWorn(true);
    announce(false);
    draw();
  }
  function play(i) {
    if (failed.has(i)) { window.open(`https://www.youtube.com/watch?v=${TRACKS[i].id}`, '_blank', 'noopener'); return; }
    playing = i; status = '';
    announce(true);
    draw();
    loadYT().then(() => {
      if (playing !== i) return;
      if (player) { player.loadVideoById(TRACKS[i].id); player.unMute(); player.setVolume(80); return; }
      player = new window.YT.Player(slot, {
        width: 2, height: 2, videoId: TRACKS[i].id,
        playerVars: { autoplay: 1, playsinline: 1, controls: 0, rel: 0 },
        events: {
          onReady: (e) => { e.target.unMute(); e.target.setVolume(80); e.target.playVideo(); },
          onError,
        },
      });
    });
  }
  function stop() {
    playing = -1; status = '';
    if (player && player.stopVideo) player.stopVideo();
    announce(false);
    setWorn(false);
    draw();
  }
  // tell the ambient sound to step aside (index.html listens)
  const announce = (on) => dispatchEvent(new CustomEvent('site-music', { detail: { playing: on } }));
  // turning the site sound off stops the music too
  addEventListener('site-sound', (e) => { if (!e.detail.on && playing >= 0) stop(); });

  // ---- headphones fade ----
  const hpMats = [];
  headphones.traverse((o) => {
    if (!o.isMesh) return;
    o.material = [].concat(o.material).map((m) => { const c = m.clone(); hpMats.push(c); return c; });
    if (o.material.length === 1) o.material = o.material[0];
  });
  let fade = 1, fadeTo = 1;
  function setWorn(on) {
    worn = on;
    document.body.classList.toggle('hp-on', on);
    fadeTo = on ? 0 : 1;
    if (infoEntry) infoEntry.body = on ? 'Change the music.' : 'Wear them.';
  }
  function update(dt) {
    if (fade === fadeTo) return;
    fade += Math.sign(fadeTo - fade) * Math.min(Math.abs(fadeTo - fade), dt / 0.6);
    for (const m of hpMats) { m.transparent = fade < 1; m.opacity = fade; m.depthWrite = fade > 0.5; }
    headphones.visible = fade > 0.001;
  }

  const content = {
    texture,
    hit(px, py) {
      if (playing >= 0 && px >= STOP.x && px <= STOP.x + STOP.w && py >= STOP.y && py <= STOP.y + STOP.h) return 'stop';
      const r = ROWS.find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
      return r ? r.i : null;
    },
    // left the menu without picking anything: take the headphones back off
    closed() { if (playing < 0) setWorn(false); },
    hover(id) { if (id !== hoverId) { hoverId = id; draw(); } },
    click(id) {
      if (id === 'stop') stop();
      else if (typeof id === 'number') play(id);
    },
  };

  // headphones clicked: put them on, turn to the monitor
  function wear() {
    setWorn(true);
    draw();
    monitor.open(content);
  }

  // only make sound while this tab is the one being looked at
  let pausedByTab = false;
  document.addEventListener('visibilitychange', () => {
    if (!player || playing < 0) return;
    if (document.hidden) { if (player.pauseVideo) { player.pauseVideo(); pausedByTab = true; } }
    else if (pausedByTab) { pausedByTab = false; if (player.playVideo) player.playVideo(); }
  });

  // the top-right "take off headphones" button (index.html) fires this
  addEventListener('take-off-headphones', () => stop());
  return { wear, update, takeOff: stop, get worn() { return worn; } };
}
