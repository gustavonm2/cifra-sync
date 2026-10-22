// Player do YouTube via IFrame API (apenas o player embutido; nenhum áudio é baixado).

export function extractVideoId(input) {
  if (!input) return null;
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = /^\/(?:embed|shorts|live|v)\/([\w-]{11})/.exec(u.pathname);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

let apiPromise = null;
function loadApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => {
        apiPromise = null;
        reject(new Error('offline'));
      };
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

/**
 * Cria/atualiza o player. Callbacks: onState('playing'|'paused'|'ended'|'buffering'|'cued'), onError(msg).
 */
export class VideoPlayer {
  constructor(host, { onState, onError }) {
    this.host = host;
    this.onState = onState;
    this.onError = onError;
    this.player = null;
    this.ready = false;
    this.videoId = null;
  }

  async load(videoId) {
    if (videoId === this.videoId && this.player) return;
    this.videoId = videoId;
    this.ready = false;
    if (!videoId) {
      this.player?.destroy?.();
      this.player = null;
      return;
    }
    let YT;
    try {
      YT = await loadApi();
    } catch {
      this.onError?.('Sem conexão: o vídeo precisa de internet.');
      return;
    }
    if (this.videoId !== videoId) return;
    if (this.player) {
      this.player.cueVideoById(videoId);
      this.ready = true;
      return;
    }
    const mount = document.createElement('div');
    this.host.replaceChildren(mount);
    this.player = new YT.Player(mount, {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => {
          this.ready = true;
        },
        onStateChange: (e) => {
          const S = YT.PlayerState;
          const map = { [S.PLAYING]: 'playing', [S.PAUSED]: 'paused', [S.ENDED]: 'ended', [S.BUFFERING]: 'buffering', [S.CUED]: 'cued' };
          if (map[e.data]) this.onState?.(map[e.data]);
        },
        onError: (e) => this.onError?.(`O YouTube não pôde reproduzir o vídeo (erro ${e.data}).`),
      },
    });
  }

  get available() {
    return this.ready && !!this.player?.getCurrentTime;
  }
  get time() {
    return this.available ? this.player.getCurrentTime() : 0;
  }
  get duration() {
    return this.available ? this.player.getDuration() || 0 : 0;
  }
  get playing() {
    return this.available && this.player.getPlayerState() === 1;
  }
  play() {
    if (this.available) this.player.playVideo();
  }
  pause() {
    if (this.available) this.player.pauseVideo();
  }
  seek(t) {
    if (this.available) this.player.seekTo(Math.max(0, t), true);
  }
}
