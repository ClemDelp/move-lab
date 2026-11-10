/**
 * Réserve d'images pour un curseur fluide.
 *
 * Demander à une vidéo d'aller à un instant précis est lent (le navigateur
 * repart de la dernière image clé, parfois 2 s plus tôt) : en glissant le
 * doigt, on ne voit donc qu'une image de temps en temps. On lit plutôt la
 * vidéo une fois en arrière-plan en gardant chaque image en mémoire (en
 * taille réduite) ; le curseur et la lecture arrière les affichent ensuite
 * instantanément.
 */

export interface FrameProgress {
  from: number
  /** jusqu'où les images sont prêtes */
  upTo: number
  /** fin visée */
  to: number
  done: boolean
}

const MAX_DIM = 480
const BUDGET = 140e6 // octets de mémoire au maximum

export class FrameStore {
  private times: number[] = []
  private bmps: ImageBitmap[] = []
  private v: HTMLVideoElement | null = null
  private dead = false
  from = 0
  to = 0
  upTo = 0
  done = false

  constructor(
    private url: string,
    private onProgress: (p: FrameProgress) => void,
  ) {}

  /** L'image affichée à l'instant t (la dernière qui commence avant t), ou null si elle n'est pas prête. */
  get(t: number): ImageBitmap | null {
    const n = this.times.length
    if (!n || t < this.from - 0.02 || t > this.upTo + 0.05) return null
    let lo = 0
    let hi = n - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.times[mid] <= t + 0.002) lo = mid
      else hi = mid - 1
    }
    // trou trop grand (image ratée pendant la préparation) : on préfère la vraie vidéo
    if (Math.abs(this.times[lo] - t) > 0.12) return null
    return this.bmps[lo]
  }

  covers(t: number) {
    return t >= this.from - 0.02 && t <= this.to + 0.02
  }

  private add(time: number, bmp: ImageBitmap) {
    if (this.dead) return bmp.close()
    let i = this.times.length
    while (i > 0 && this.times[i - 1] > time) i--
    if (i > 0 && Math.abs(this.times[i - 1] - time) < 1e-4) {
      bmp.close()
      return
    }
    this.times.splice(i, 0, time)
    this.bmps.splice(i, 0, bmp)
  }

  private report(upTo: number) {
    this.upTo = Math.max(this.upTo, upTo)
    if (!this.dead) this.onProgress({ from: this.from, upTo: this.upTo, to: this.to, done: this.done })
  }

  /** Prépare les images entre `from` et `to` (raccourci si la mémoire ne suffit pas). */
  async build(from: number, to: number, fpsGuess: number) {
    const v = document.createElement('video')
    this.v = v
    v.muted = true
    v.playsInline = true
    v.setAttribute('playsinline', '')
    v.preload = 'auto'
    // dans la page mais invisible : certains navigateurs ne décodent pas une vidéo détachée
    Object.assign(v.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '2px',
      height: '2px',
      opacity: '0',
      pointerEvents: 'none',
    })
    document.body.appendChild(v)
    v.src = this.url
    await once(v, 'loadedmetadata')
    if (this.dead) return

    const scale = Math.min(1, MAX_DIM / Math.max(v.videoWidth, v.videoHeight))
    const w = Math.max(1, Math.round(v.videoWidth * scale))
    const h = Math.max(1, Math.round(v.videoHeight * scale))
    const maxFrames = Math.floor(BUDGET / (w * h * 4))
    const fps = Math.max(fpsGuess, 24)
    this.from = from
    this.to = Math.min(to, from + maxFrames / Math.max(fps, 30))
    this.upTo = from

    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')!
    const grab = async (time: number) => {
      ctx.drawImage(v, 0, 0, w, h)
      this.add(time, await createImageBitmap(c))
    }

    v.currentTime = from
    await once(v, 'seeked')
    if (this.dead) return
    await grab(from)

    const canPlay = 'requestVideoFrameCallback' in v && (await v.play().then(() => true, () => false))
    if (canPlay && !this.dead) await this.byPlaying(v, grab, fps)
    // lecture impossible (mode économie d'énergie sur iPhone…) : image par image
    else if (!this.dead) await this.bySeeking(v, grab, fps)
    if (this.dead) return
    this.done = true
    this.report(this.to)
    this.cleanupVideo()
  }

  /** On lit la vidéo (2× plus vite) et on garde chaque image présentée. */
  private byPlaying(v: HTMLVideoElement, grab: (t: number) => Promise<void>, fps: number) {
    v.playbackRate = fps > 40 ? 1 : 2
    return new Promise<void>((resolve) => {
      let last = performance.now()
      const cb = (_: number, meta: VideoFrameCallbackMetadata) => {
        if (this.dead) return resolve()
        const t = meta.mediaTime
        if (t >= this.to || v.ended) {
          v.pause()
          return resolve()
        }
        v.requestVideoFrameCallback(cb)
        grab(t)
        const now = performance.now()
        if (now - last > 150) {
          last = now
          this.report(t)
        }
      }
      v.requestVideoFrameCallback(cb)
      v.addEventListener('ended', () => resolve(), { once: true })
    })
  }

  private async bySeeking(v: HTMLVideoElement, grab: (t: number) => Promise<void>, fps: number) {
    for (let i = 1; !this.dead; i++) {
      const t = this.from + i / fps
      if (t >= this.to) break
      v.currentTime = t
      await once(v, 'seeked')
      if (this.dead) return
      await grab(t)
      if (i % 5 === 0) this.report(t)
    }
  }

  private cleanupVideo() {
    if (!this.v) return
    this.v.pause()
    this.v.removeAttribute('src')
    this.v.load()
    this.v.remove()
    this.v = null
  }

  dispose() {
    this.dead = true
    this.cleanupVideo()
    this.bmps.forEach((b) => b.close())
    this.bmps = []
    this.times = []
  }
}

function once(el: HTMLElement, ev: string) {
  return new Promise<void>((resolve, reject) => {
    const ok = () => (el.removeEventListener('error', ko), resolve())
    const ko = () => (el.removeEventListener(ev, ok), reject(new Error('video error')))
    el.addEventListener(ev, ok, { once: true })
    el.addEventListener('error', ko, { once: true })
  })
}
