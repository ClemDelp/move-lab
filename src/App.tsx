import { useEffect, useRef, useState } from 'react'
import { decodeGif, gifFrameAt, type DecodedGif } from './gif'
import { exportSheet } from './sheet'
import { detectPose, drawPose, loadPoseModel, type Pose } from './pose'
import { FrameStore, type FrameProgress } from './frames'
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { deleteClip, getClip, listClips, saveClip, updateClip, type LibEntry } from './library'

type Kind = 'video' | 'gif'

interface Clip {
  name: string
  /** clé de sauvegarde des annotations (nom + taille du fichier) */
  key: string
  kind: Kind
  url?: string
  gif?: DecodedGif
  /** vidéo chargée depuis une URL sans CORS : pas de capture d'image possible */
  tainted?: boolean
  /** nom affiché (bibliothèque) */
  title?: string
  /** vidéo gardée dans la bibliothèque */
  saved?: boolean
}

interface Step {
  id: string
  t: number
  label: string
  thumb: string | null
}

interface Saved {
  steps: Step[]
  a: number | null
  b: number | null
  fps: number | null
}

const PX_PER_FRAME = 6
const SPEEDS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2]
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|ogv)$/i
const SOCIAL = /(instagram\.com|pinterest\.|pin\.it|tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|x\.com|twitter\.com)/i

const fmt = (s: number) => {
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return `${m}:${r.toFixed(2).padStart(5, '0')}`
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const uid = () => Math.random().toString(36).slice(2, 9)

function loadSaved(key: string): Saved | null {
  try {
    const raw = localStorage.getItem('movelab:' + key)
    return raw ? (JSON.parse(raw) as Saved) : null
  } catch {
    return null
  }
}

export default function App() {
  const [clip, setClip] = useState<Clip | null>(null)
  const [duration, setDuration] = useState(0)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [dir, setDir] = useState<1 | -1>(1)
  const [rate, setRate] = useState(0.5)
  const [loopOn, setLoopOn] = useState(true)
  const [a, setA] = useState<number | null>(null)
  const [b, setB] = useState<number | null>(null)
  const [mirror, setMirror] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [fps, setFps] = useState(30)
  const [fpsAuto, setFpsAuto] = useState(true)
  const [muted, setMuted] = useState(true)
  const [steps, setSteps] = useState<Step[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  /** format de l'image (largeur / hauteur) pour ajuster la zone vidéo */
  const [aspect, setAspect] = useState<number | null>(null)
  const [library, setLibrary] = useState<LibEntry[]>([])
  const [scrubbing, setScrubbing] = useState(false)
  const scrubbingRef = useRef(false)
  const pendingSeek = useRef<number | null>(null)
  /** images préparées pour le curseur fluide (vidéo uniquement) */
  const framesRef = useRef<FrameStore | null>(null)
  const [frameInfo, setFrameInfo] = useState<FrameProgress | null>(null)
  /** recentre la préparation sur cet instant (longues vidéos sans boucle) */
  const [frameFocus, setFrameFocus] = useState(0)
  const layerRef = useRef<HTMLCanvasElement>(null)
  const layerOn = useRef(false)
  const hideOnSeeked = useRef(false)
  const libThumbRef = useRef<string | null>(null)
  const [poseOn, setPoseOn] = useState(false)
  const [poseStatus, setPoseStatus] = useState<'idle' | 'loading' | 'ready'>('idle')
  const [poseFound, setPoseFound] = useState(true)

  const overlayRef = useRef<HTMLCanvasElement>(null)
  const modelRef = useRef<PoseLandmarker | null>(null)
  const poseRef = useRef<Pose | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const tRef = useRef(0)
  const rafRef = useRef(0)
  const lastRef = useRef(0)
  const gifIdxRef = useRef(-1)

  // valeurs lues par la boucle d'animation (évite les closures périmées)
  const live = useRef({ kind: 'video' as Kind, gif: undefined as DecodedGif | undefined, rate, dir, a, b, loopOn, duration })
  live.current = { ...live.current, kind: clip?.kind ?? 'video', gif: clip?.gif, rate, a, b, loopOn, duration }

  const lo = a ?? 0
  const hi = b ?? duration
  const gif = clip?.gif
  const frameIndex = gif ? gifFrameAt(gif, t) : Math.floor(t * fps + 1e-3)
  const frameCount = gif ? gif.frames.length : Math.max(1, Math.round(duration * fps))

  /* ---------- moteur de lecture ---------- */

  function drawGif(time: number) {
    const g = live.current.gif
    const c = canvasRef.current
    if (!g || !c) return
    const idx = gifFrameAt(g, time)
    if (idx === gifIdxRef.current) return
    gifIdxRef.current = idx
    c.getContext('2d')!.putImageData(g.frames[idx], 0, 0)
  }

  /** Affiche l'image préparée pour cet instant par-dessus la vidéo. */
  function showFrame(time: number): boolean {
    const bmp = framesRef.current?.get(time)
    const c = layerRef.current
    if (!bmp || !c) return false
    if (c.width !== bmp.width) c.width = bmp.width
    if (c.height !== bmp.height) c.height = bmp.height
    c.getContext('2d')!.drawImage(bmp, 0, 0)
    hideOnSeeked.current = false
    if (!layerOn.current) {
      layerOn.current = true
      c.style.visibility = 'visible'
    }
    return true
  }

  function hideLayer() {
    hideOnSeeked.current = false
    if (!layerOn.current) return
    layerOn.current = false
    if (layerRef.current) layerRef.current.style.visibility = 'hidden'
  }

  /** Amène la vraie vidéo à tRef, puis retire l'image préparée quand elle y est. */
  function settleVideo() {
    const v = videoRef.current
    if (!v) return hideLayer()
    pendingSeek.current = null
    if (Math.abs(v.currentTime - tRef.current) > 1e-4) v.currentTime = tRef.current
    if (v.seeking && layerOn.current) hideOnSeeked.current = true
    else hideLayer()
  }

  function seek(time: number) {
    const nt = clamp(time, 0, live.current.duration || 0)
    tRef.current = nt
    if (live.current.kind === 'video') settleVideo()
    else drawGif(nt)
    setT(nt)
  }

  /** Déplacement continu (curseur ou glisser sur l'image) : image préparée si
   *  possible, sinon on enchaîne les recherches sans les empiler. */
  function scrubTo(time: number) {
    const nt = clamp(time, 0, live.current.duration || 0)
    tRef.current = nt
    setT(nt)
    if (live.current.kind === 'gif') return drawGif(nt)
    if (showFrame(nt)) return
    hideLayer()
    const v = videoRef.current
    if (!v) return
    if (v.seeking) pendingSeek.current = nt
    else v.currentTime = nt
  }

  function scrubStart() {
    if (playing) pause()
    scrubbingRef.current = true
    setScrubbing(true)
  }

  function scrubEnd() {
    scrubbingRef.current = false
    setScrubbing(false)
    if (live.current.kind !== 'video') return
    settleVideo()
    // longue vidéo : préparer la zone où l'on travaille
    const f = framesRef.current
    if (f && f.to > f.from && !f.covers(tRef.current)) setFrameFocus(tRef.current)
  }

  function stopLoop() {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
  }

  function pause() {
    stopLoop()
    const v = videoRef.current
    if (live.current.kind === 'video' && v) {
      v.pause()
      if (live.current.dir === 1 && !layerOn.current) tRef.current = v.currentTime
      else settleVideo()
    }
    setPlaying(false)
    setT(tRef.current)
  }

  function tick(now: number) {
    const L = live.current
    const dt = lastRef.current ? Math.min(0.25, (now - lastRef.current) / 1000) : 0
    lastRef.current = now
    const lo = L.a ?? 0
    const hi = L.b ?? L.duration
    const v = videoRef.current

    if (L.kind === 'video' && L.dir === 1 && v) {
      // lecture avant : le navigateur joue la vidéo, on surveille la boucle
      let cur = v.currentTime
      if (cur >= hi - 0.01 || v.ended) {
        if (!L.loopOn) return finish(hi)
        v.currentTime = cur = lo
        if (v.paused) v.play().catch(() => {})
      }
      tRef.current = cur
      setT(cur)
    } else {
      // lecture arrière (vidéo) ou GIF : horloge virtuelle
      let nt = tRef.current + dt * L.rate * L.dir
      if (L.dir === 1 && nt >= hi) {
        if (!L.loopOn) return finish(hi)
        nt = lo
      } else if (L.dir === -1 && nt <= lo) {
        if (!L.loopOn) return finish(lo)
        nt = hi
      }
      tRef.current = nt
      if (L.kind === 'video') {
        if (!showFrame(nt)) {
          hideLayer()
          if (v && !v.seeking) v.currentTime = nt
        }
      } else drawGif(nt)
      setT(nt)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function finish(at: number) {
    stopLoop()
    videoRef.current?.pause()
    seek(at)
    setPlaying(false)
  }

  function play(d: 1 | -1) {
    const L = live.current
    L.dir = d
    setDir(d)
    if (d === 1 && (tRef.current >= hi - 0.02 || tRef.current < lo)) seek(lo)
    if (d === -1 && (tRef.current <= lo + 0.02 || tRef.current > hi)) seek(hi)
    const v = videoRef.current
    if (L.kind === 'video' && v) {
      if (d === 1) {
        if (layerOn.current) {
          hideLayer()
          v.currentTime = tRef.current
        }
        v.playbackRate = L.rate
        v.play().catch(() => {})
      } else v.pause()
    }
    setPlaying(true)
    stopLoop()
    lastRef.current = 0
    rafRef.current = requestAnimationFrame(tick)
  }

  function toggle(d: 1 | -1 = dir) {
    if (playing && d === dir) pause()
    else play(d)
  }

  function step(n: number) {
    if (playing) pause()
    if (gif) {
      const idx = clamp(gifFrameAt(gif, tRef.current) + n, 0, gif.frames.length - 1)
      seek(gif.starts[idx])
    } else {
      const f = clamp(Math.floor(tRef.current * fps + 1e-3) + n, 0, frameCount - 1)
      // viser le milieu de l'image pour tomber pile dessus
      seek(Math.min(duration, (f + 0.5) / fps))
    }
  }

  function changeRate(r: number) {
    setRate(r)
    live.current.rate = r
    const v = videoRef.current
    if (v && playing && dir === 1) v.playbackRate = r
  }

  function nudgeRate(delta: number) {
    const i = SPEEDS.findIndex((s) => s >= rate - 1e-6)
    changeRate(SPEEDS[clamp((i < 0 ? SPEEDS.length - 1 : i) + delta, 0, SPEEDS.length - 1)])
  }

  /* ---------- import ---------- */

  function refreshLibrary() {
    listClips()
      .then(setLibrary)
      .catch(() => {})
  }

  async function openFromLibrary(key: string) {
    const e = await getClip(key).catch(() => undefined)
    if (!e) return setMsg('Cette vidéo n’est plus dans ta bibliothèque.')
    await importFile(new File([e.blob], e.name, { type: e.type }))
  }

  async function renameClip(key: string, current: string) {
    const title = window.prompt('Nom du mouvement', current)?.trim()
    if (!title) return
    await updateClip(key, { title }).catch(() => {})
    refreshLibrary()
  }

  async function removeClip(key: string, title: string) {
    if (!window.confirm(`Supprimer « ${title} » et sa décomposition de cet appareil ?`)) return
    await deleteClip(key).catch(() => {})
    refreshLibrary()
  }

  function closeClip() {
    pause()
    if (clip?.url?.startsWith('blob:')) URL.revokeObjectURL(clip.url)
    setClip(null)
    setPoseOn(false)
    refreshLibrary()
  }

  async function importFile(file: File) {
    pause()
    setFrameFocus(0)
    setMsg(null)
    const key = `${file.name}:${file.size}`
    const isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name)
    const isVideo = file.type.startsWith('video/') || VIDEO_EXT.test(file.name)
    if (!isGif && !isVideo) {
      setMsg(`Format non pris en charge : ${file.type || file.name}. Utilise une vidéo (mp4, mov, webm) ou un GIF.`)
      return
    }
    if (clip?.url?.startsWith('blob:')) URL.revokeObjectURL(clip.url)
    if (isGif) {
      setLoading(true)
      try {
        const g = decodeGif(await file.arrayBuffer())
        openClip({ name: file.name, key, kind: 'gif', gif: g }, g.duration)
        keep(file, key)
      } catch {
        setMsg('Impossible de lire ce GIF.')
      } finally {
        setLoading(false)
      }
    } else {
      openClip({ name: file.name, key, kind: 'video', url: URL.createObjectURL(file) }, 0)
      keep(file, key)
    }
  }

  /** garde la vidéo dans la bibliothèque de l'appareil */
  function keep(file: File, key: string) {
    saveClip(file, key)
      .then(() => getClip(key))
      .then((e) => {
        libThumbRef.current = e?.thumb ?? null
        if (e) setClip((c) => (c && c.key === key ? { ...c, title: e.title, saved: true } : c))
      })
      .catch(() =>
        setMsg('Pas assez de place pour garder cette vidéo sur l’appareil : ta décomposition est gardée, mais il faudra réimporter la vidéo.'),
      )
  }

  function openClip(c: Clip, dur: number) {
    const saved = loadSaved(c.key)
    tRef.current = 0
    gifIdxRef.current = -1
    live.current = { ...live.current, kind: c.kind, gif: c.gif, duration: dur }
    setClip(c)
    setDuration(dur)
    setT(0)
    setSteps(saved?.steps ?? [])
    setA(saved?.a ?? null)
    setB(saved?.b ?? null)
    setFpsAuto(!saved?.fps)
    setFps(saved?.fps ?? 30)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setAspect(c.gif ? c.gif.width / c.gif.height : null)
  }

  async function importUrl(raw: string) {
    const u = raw.trim()
    if (!u) return
    const direct = /\.(mp4|m4v|mov|webm|gif)(\?|#|$)/i.test(u)
    if (SOCIAL.test(u) && !direct) {
      setMsg(
        "Les liens de page Instagram / Pinterest / TikTok ne donnent pas accès au fichier vidéo depuis le navigateur. " +
          'Enregistre la vidéo sur ton téléphone ou ton ordi (voir l’astuce plus bas), puis importe le fichier.',
      )
      return
    }
    setLoading(true)
    setMsg(null)
    try {
      const res = await fetch(u)
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const name = decodeURIComponent(new URL(u).pathname.split('/').pop() || 'video')
      await importFile(new File([blob], name, { type: blob.type }))
      setUrl('')
    } catch {
      if (/\.gif(\?|#|$)/i.test(u)) {
        setMsg('Ce site bloque le téléchargement direct du GIF. Enregistre-le puis importe le fichier.')
      } else {
        // dernier recours : lecture directe (sans capture d'étapes)
        pause()
        openClip({ name: u.split('/').pop() || 'video', key: u, kind: 'video', url: u, tainted: true }, 0)
        setMsg('Vidéo lue en direct : ce site empêche les captures, les vignettes d’étapes seront vides.')
        setUrl('')
      }
    } finally {
      setLoading(false)
    }
  }

  /* ---------- squelette ---------- */

  /** Détecte et dessine le squelette sur l'image affichée. */
  function runPose(): Pose | null {
    const src =
      live.current.kind === 'gif' ? canvasRef.current : layerOn.current ? layerRef.current : videoRef.current
    const ov = overlayRef.current
    const model = modelRef.current
    if (!src || !ov || !model) return null
    const w = src instanceof HTMLVideoElement ? src.videoWidth : src.width
    const h = src instanceof HTMLVideoElement ? src.videoHeight : src.height
    if (!w || !h) return null
    if (ov.width !== w) ov.width = w
    if (ov.height !== h) ov.height = h
    const pose = detectPose(model, src, w, h)
    poseRef.current = pose
    setPoseFound(!!pose)
    const ctx = ov.getContext('2d')!
    if (pose) drawPose(ctx, pose, w, h)
    else ctx.clearRect(0, 0, w, h)
    return pose
  }

  async function togglePose() {
    if (poseOn) return setPoseOn(false)
    if (clip?.tainted) {
      setMsg('Le squelette n’est pas disponible pour une vidéo lue en direct depuis un autre site : importe le fichier.')
      return
    }
    setPoseOn(true)
    if (modelRef.current) return
    setPoseStatus('loading')
    try {
      modelRef.current = await loadPoseModel()
      setPoseStatus('ready')
    } catch {
      setPoseStatus('idle')
      setPoseOn(false)
      setMsg('Impossible de charger le modèle de détection (il faut une connexion internet la première fois).')
    }
  }

  /* ---------- étapes (décomposition) ---------- */

  function snapshot(): string | null {
    const src = clip?.kind === 'gif' ? canvasRef.current : videoRef.current
    if (!src || clip?.tainted) return null
    const w0 = src instanceof HTMLVideoElement ? src.videoWidth : src.width
    const h0 = src instanceof HTMLVideoElement ? src.videoHeight : src.height
    if (!w0 || !h0) return null
    const c = document.createElement('canvas')
    c.width = 320
    c.height = Math.round((320 * h0) / w0)
    const ctx = c.getContext('2d')!
    if (mirror) {
      ctx.translate(c.width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(src, 0, 0, c.width, c.height)
    // le squelette par-dessus
    if (poseOn && poseRef.current && overlayRef.current) ctx.drawImage(overlayRef.current, 0, 0, c.width, c.height)
    try {
      return c.toDataURL('image/jpeg', 0.8)
    } catch {
      return null
    }
  }

  async function addStep() {
    if (!clip) return
    if (playing) pause()
    // attendre que la vidéo affiche bien l'image demandée avant de la capturer
    const v = videoRef.current
    if (clip.kind === 'video' && v?.seeking) await new Promise((r) => v.addEventListener('seeked', r, { once: true }))
    const time = tRef.current
    if (poseOn && modelRef.current) {
      try {
        runPose()
      } catch {
        /* pas de squelette pour cette image */
      }
    }
    const thumb = snapshot()
    setSteps((s) =>
      [...s.filter((x) => Math.abs(x.t - time) > 1e-3), { id: uid(), t: time, label: '', thumb }].sort(
        (x, y) => x.t - y.t,
      ),
    )
  }

  function jumpStep(delta: number) {
    if (!steps.length) return
    const cur = tRef.current
    const target =
      delta > 0 ? steps.find((s) => s.t > cur + 1e-3) : [...steps].reverse().find((s) => s.t < cur - 1e-3)
    if (target) {
      if (playing) pause()
      seek(target.t)
    }
  }

  /* ---------- effets ---------- */

  // sauvegarde locale des annotations
  useEffect(() => {
    if (!clip) return
    const data: Saved = { steps, a, b, fps: fpsAuto ? null : fps }
    try {
      localStorage.setItem('movelab:' + clip.key, JSON.stringify(data))
    } catch {
      /* stockage plein ou indisponible : on continue sans */
    }
  }, [clip, steps, a, b, fps, fpsAuto])

  // vignette de la bibliothèque : la 1re étape si elle existe, sinon l'image d'ouverture
  useEffect(() => {
    if (!clip?.saved) return
    const first = steps.find((s) => s.thumb)?.thumb ?? null
    if (first && first !== libThumbRef.current) {
      libThumbRef.current = first
      updateClip(clip.key, { thumb: first }).catch(() => {})
    } else if (!first && !libThumbRef.current && duration > 0) {
      const id = setTimeout(() => {
        const th = snapshot()
        if (th) {
          libThumbRef.current = th
          updateClip(clip.key, { thumb: th }).catch(() => {})
        }
      }, 400)
      return () => clearTimeout(id)
    }
  }, [clip, steps, duration])

  useEffect(refreshLibrary, [])

  // première image du GIF
  useEffect(() => {
    if (clip?.kind !== 'gif' || !clip.gif || !canvasRef.current) return
    canvasRef.current.width = clip.gif.width
    canvasRef.current.height = clip.gif.height
    gifIdxRef.current = -1
    drawGif(0)
  }, [clip])

  // squelette : détection à chaque nouvelle image affichée
  useEffect(() => {
    if (!poseOn || poseStatus !== 'ready' || !clip) {
      poseRef.current = null
      return
    }
    let raf = 0
    let lastKey = ''
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (scrubbingRef.current) return
      const v = videoRef.current
      let key: string
      if (live.current.kind === 'video' && layerOn.current) key = 'L' + tRef.current.toFixed(4)
      else if (live.current.kind === 'video') {
        if (!v || v.readyState < 2 || v.seeking) return
        key = v.currentTime.toFixed(4)
      } else key = 'g' + gifIdxRef.current
      key += mirror ? 'm' : ''
      if (key === lastKey) return
      lastKey = key
      try {
        runPose()
      } catch {
        cancelAnimationFrame(raf)
        setPoseOn(false)
        setMsg('La détection du squelette a échoué sur cette vidéo.')
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [poseOn, poseStatus, clip, mirror])

  // préparation des images pour le curseur fluide : la boucle A–B si elle
  // existe, sinon toute la vidéo (ou ce qui tient en mémoire autour de l'endroit travaillé)
  const fpsRef = useRef(fps)
  fpsRef.current = fps
  useEffect(() => {
    if (clip?.kind !== 'video' || !clip.url || clip.tainted || !duration) return
    const from = a ?? (b === null ? Math.max(0, Math.min(frameFocus - 1, duration)) : 0)
    const to = b ?? duration
    if (to - from < 0.05) return
    let store: FrameStore | null = null
    // petit délai : on ne relance pas tout pendant qu'on règle A et B
    const id = setTimeout(() => {
      store = new FrameStore(clip.url!, setFrameInfo)
      framesRef.current = store
      store.build(from, to, fpsRef.current).catch(() => {})
    }, 600)
    return () => {
      clearTimeout(id)
      if (store) {
        if (framesRef.current === store) framesRef.current = null
        store.dispose()
      }
      hideLayer()
      setFrameInfo(null)
    }
  }, [clip, duration, a, b, frameFocus])

  // détection automatique des images/seconde pendant la lecture vidéo
  useEffect(() => {
    const v = videoRef.current
    if (clip?.kind !== 'video' || !v || !('requestVideoFrameCallback' in v) || !fpsAuto) return
    const diffs: number[] = []
    let last = -1
    let handle = 0
    const cb = (_: number, meta: VideoFrameCallbackMetadata) => {
      if (last >= 0 && !v.paused) {
        const d = meta.mediaTime - last
        if (d > 0.004 && d < 0.2) diffs.push(d)
      }
      last = meta.mediaTime
      if (diffs.length >= 12) {
        const sorted = [...diffs].sort((x, y) => x - y)
        const detected = Math.round(1 / sorted[Math.floor(sorted.length / 4)])
        if (detected >= 6 && detected <= 120) setFps(detected)
        return
      }
      handle = v.requestVideoFrameCallback(cb)
    }
    handle = v.requestVideoFrameCallback(cb)
    return () => v.cancelVideoFrameCallback(handle)
  }, [clip, fpsAuto])

  // clavier
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select') || !clip) return
      const k = e.key
      const handled = true
      if (k === ' ' || k === 'k') toggle(1)
      else if (k === 'j') play(-1)
      else if (k === 'l') play(1)
      else if (k === 'ArrowRight') e.shiftKey ? (pause(), seek(tRef.current + 1)) : step(1)
      else if (k === 'ArrowLeft') e.shiftKey ? (pause(), seek(tRef.current - 1)) : step(-1)
      else if (k === 'ArrowDown') jumpStep(1)
      else if (k === 'ArrowUp') jumpStep(-1)
      else if (k === '[') setA(tRef.current)
      else if (k === ']') setB(tRef.current)
      else if (k === 'Escape') (setA(null), setB(null))
      else if (k === 'm') setMirror((m) => !m)
      else if (k === 's') addStep()
      else if (k === 'p') togglePose()
      else if (k === '-') nudgeRate(-1)
      else if (k === '+' || k === '=') nudgeRate(1)
      else if (k === '0') (setZoom(1), setPan({ x: 0, y: 0 }))
      else return
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // zoom à la molette (écouteur non passif pour bloquer le scroll)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom((z) => {
        const nz = clamp(z * Math.exp(-e.deltaY * 0.0015), 1, 8)
        if (nz === 1) setPan({ x: 0, y: 0 })
        return nz
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [clip])

  // glisser-déposer et coller
  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault()
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const f = e.dataTransfer?.files?.[0]
      if (f) importFile(f)
      else {
        const text = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain')
        if (text) importUrl(text)
      }
    }
    const paste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      const f = e.clipboardData?.files?.[0]
      if (f) importFile(f)
      else {
        const text = e.clipboardData?.getData('text')
        if (text && /^https?:\/\//.test(text.trim())) importUrl(text)
      }
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    window.addEventListener('paste', paste)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      window.removeEventListener('paste', paste)
    }
  })

  useEffect(() => () => stopLoop(), [])

  /* ---------- zoom / déplacement au doigt ou à la souris ---------- */

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; z: number } | null>(null)

  const tap = useRef<{ x: number; y: number; at: number } | null>(null)
  const drag = useRef<{ x: number; t: number; active: boolean } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* rien */
    }
    tap.current = pointers.current.size === 0 ? { x: e.clientX, y: e.clientY, at: performance.now() } : null
    drag.current = pointers.current.size === 0 ? { x: e.clientX, t: tRef.current, active: false } : null
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      drag.current = null
      const [p, q] = [...pointers.current.values()]
      pinch.current = { d: Math.hypot(p.x - q.x, p.y - q.y), z: zoom }
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const cur = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, cur)
    if (pointers.current.size === 2 && pinch.current) {
      const [p, q] = [...pointers.current.values()]
      const nz = clamp((pinch.current.z * Math.hypot(p.x - q.x, p.y - q.y)) / pinch.current.d, 1, 8)
      setZoom(nz)
      if (nz === 1) setPan({ x: 0, y: 0 })
    } else if (pointers.current.size === 1 && zoom > 1) {
      setPan((pp) => ({ x: pp.x + cur.x - prev.x, y: pp.y + cur.y - prev.y }))
    } else if (pointers.current.size === 1 && drag.current) {
      // glisser à gauche / à droite sur l'image = reculer / avancer dans le mouvement
      const d = drag.current
      const dx = cur.x - d.x
      if (!d.active && Math.abs(dx) > 8) {
        d.active = true
        d.x = cur.x
        d.t = playing ? (videoRef.current?.currentTime ?? tRef.current) : tRef.current
        scrubStart()
        return
      }
      if (d.active) {
        // réglage fin : une image tous les PX_PER_FRAME pixels
        const rate = gif ? gif.frames.length / (duration || 1) : fps
        scrubTo(d.t + (mirror ? -dx : dx) / (PX_PER_FRAME * rate))
      }
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    // un appui bref sans glisser = lecture / pause
    const t0 = tap.current
    if (
      e.type === 'pointerup' &&
      t0 &&
      pointers.current.size === 1 &&
      performance.now() - t0.at < 300 &&
      Math.hypot(e.clientX - t0.x, e.clientY - t0.y) < 10
    )
      playing ? pause() : play(1)
    tap.current = null
    if (drag.current?.active) scrubEnd()
    drag.current = null
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }

  /* ---------- rendu ---------- */

  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom * (mirror ? -1 : 1)}, ${zoom})`
  const pct = (x: number) => (duration ? (x / duration) * 100 : 0)

  return (
    <div className={`app ${dragging ? 'dragging' : ''}`}>
      <header className="top">
        {clip ? (
          <button className="btn ghost back" onClick={closeClip} aria-label="Retour à mes mouvements">
            ‹ <span className="back-label">Mes mouvements</span>
          </button>
        ) : (
          <div className="brand">
            <img src="./icon.svg" alt="" width={28} height={28} />
            <span>Move Lab</span>
          </div>
        )}
        {clip && (
          <button
            className="clip-name"
            title={clip.saved ? 'Renommer' : clip.name}
            onClick={() => clip.saved && renameClip(clip.key, clip.title ?? clip.name).then(() =>
              getClip(clip.key).then((e) => e && setClip((c) => (c && c.key === e.key ? { ...c, title: e.title } : c))),
            )}
          >
            {clip.title ?? clip.name}
            {clip.saved && <span className="saved"> · enregistré ✓</span>}
          </button>
        )}
        <div className="top-actions">
          <button className="btn primary" onClick={() => fileRef.current?.click()}>
            Importer
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,image/gif,.gif,.mp4,.mov,.webm"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) importFile(f)
            e.target.value = ''
          }}
        />
      </header>

      {msg && (
        <div className="msg" role="status">
          <span>{msg}</span>
          <button className="icon-btn" onClick={() => setMsg(null)} aria-label="Fermer">
            ×
          </button>
        </div>
      )}

      {!clip ? (
        <Welcome
          loading={loading}
          url={url}
          setUrl={setUrl}
          onPick={() => fileRef.current?.click()}
          onUrl={() => importUrl(url)}
          library={library}
          onOpen={openFromLibrary}
          onRename={renameClip}
          onDelete={removeClip}
        />
      ) : (
        <main className="lab">
          <section className="player">
            <div
              className="stage"
              ref={stageRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              style={{ cursor: zoom > 1 ? 'grab' : 'pointer', ...(aspect ? { height: 'auto', aspectRatio: String(aspect) } : {}) }}
            >
              {clip.kind === 'video' ? (
                <video
                  key={clip.url}
                  ref={videoRef}
                  className="media"
                  src={clip.url}
                  style={{ transform }}
                  muted={muted}
                  playsInline
                  preload="auto"
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget
                    if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight)
                    if (Number.isFinite(v.duration)) {
                      setDuration(v.duration)
                      live.current.duration = v.duration
                    } else {
                      // certains webm n'annoncent pas leur durée : on force le calcul
                      v.currentTime = 1e9
                      v.addEventListener(
                        'timeupdate',
                        () => {
                          setDuration(v.duration)
                          live.current.duration = v.duration
                          v.currentTime = 0
                        },
                        { once: true },
                      )
                    }
                  }}
                  onSeeked={(e) => {
                    const next = pendingSeek.current
                    if (next !== null) {
                      pendingSeek.current = null
                      e.currentTarget.currentTime = next
                    } else if (hideOnSeeked.current) hideLayer()
                  }}
                  onError={() => setMsg('Impossible de lire cette vidéo dans ce navigateur.')}
                />
              ) : (
                <canvas ref={canvasRef} className="media" style={{ transform }} />
              )}
              {clip.kind === 'video' && <canvas ref={layerRef} className="media layer" style={{ transform }} />}
              {poseOn && <canvas ref={overlayRef} className="media overlay" style={{ transform }} />}
              {zoom > 1 && (
                <button
                  className="zoom-badge"
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                  onClick={() => (setZoom(1), setPan({ x: 0, y: 0 }))}
                  title="Réinitialiser le zoom (0)"
                >
                  ×{zoom.toFixed(1)} · Réinitialiser
                </button>
              )}
              {scrubbing && (
                <div className="scrub-badge">
                  {fmt(t)} · image {Math.min(frameIndex + 1, frameCount)}
                </div>
              )}
              {poseOn && (poseStatus === 'loading' || !poseFound) && (
                <div className="pose-badge">
                  {poseStatus === 'loading' ? 'Chargement du modèle de squelette…' : 'Aucun corps détecté sur cette image'}
                </div>
              )}
            </div>

            <Timeline
              duration={duration}
              t={t}
              a={a}
              b={b}
              steps={steps}
              pct={pct}
              cached={frameInfo ? [frameInfo.from, frameInfo.upTo] : null}
              onScrubStart={scrubStart}
              onScrub={scrubTo}
              onScrubEnd={scrubEnd}
              onJump={(x) => {
                if (playing) pause()
                seek(x)
              }}
            />

            <div className="readout">
              <span>
                {fmt(t)} <span className="dim">/ {fmt(duration)}</span>
              </span>
              <span>
                image {Math.min(frameIndex + 1, frameCount)} <span className="dim">/ {frameCount}</span>
              </span>
            </div>

            <div className="controls">
              <div className="transport">
                <button className="btn icon" onClick={() => step(-1)} title="Image précédente (←)" aria-label="Image précédente">
                  ◀︎|
                </button>
                <button
                  className={`btn icon ${playing && dir === -1 ? 'on' : ''}`}
                  onClick={() => toggle(-1)}
                  title="Lecture arrière (J)"
                  aria-label="Lecture arrière"
                >
                  ◀︎
                </button>
                <button
                  className={`btn icon play ${playing && dir === 1 ? 'on' : ''}`}
                  onClick={() => (playing ? pause() : play(1))}
                  title="Lecture / pause (espace)"
                  aria-label={playing ? 'Pause' : 'Lecture'}
                >
                  {playing ? '❚❚' : '▶︎'}
                </button>
                <button className="btn icon" onClick={() => step(1)} title="Image suivante (→)" aria-label="Image suivante">
                  |▶︎
                </button>
                <button
                  className="btn speed mobile-only"
                  onClick={() => changeRate(SPEEDS[(SPEEDS.findIndex((x) => Math.abs(x - rate) < 1e-6) + 1) % SPEEDS.length])}
                  aria-label="Changer la vitesse"
                >
                  {rate}×
                </button>
                <button className="btn primary add" onClick={addStep} title="Ajouter l’image actuelle comme étape (S)">
                  + Étape
                </button>
              </div>

              <div className="speeds desktop-only" role="group" aria-label="Vitesse">
                {SPEEDS.map((s) => (
                  <button key={s} className={`chip ${Math.abs(rate - s) < 1e-6 ? 'on' : ''}`} onClick={() => changeRate(s)}>
                    {s}×
                  </button>
                ))}
              </div>

              <div className="tools">
                <button className="btn" onClick={() => setA(tRef.current)} title="Début de boucle ([)">
                  A
                </button>
                <button className="btn" onClick={() => setB(tRef.current)} title="Fin de boucle (])">
                  B
                </button>
                <button className={`btn ${loopOn ? 'on' : ''}`} onClick={() => setLoopOn((l) => !l)} title="Boucle">
                  ⟲ Boucle
                </button>
                {(a !== null || b !== null) && (
                  <button className="btn ghost" onClick={() => (setA(null), setB(null))} title="Effacer A–B (Échap)">
                    Effacer A–B
                  </button>
                )}
                <span className="sep" />
                <button className={`btn ${mirror ? 'on' : ''}`} onClick={() => setMirror((m) => !m)} title="Miroir (M)">
                  ⇋ Miroir
                </button>
                <button
                  className={`btn ${poseOn ? 'on' : ''}`}
                  onClick={togglePose}
                  title="Squelette (P)"
                >
                  {poseStatus === 'loading' && poseOn ? 'Squelette…' : '◉ Squelette'}
                </button>
                {steps.length > 0 && (
                  <>
                    <span className="sep" />
                    <button className="btn" onClick={() => jumpStep(-1)} title="Étape précédente (↑)">
                      ‹ Étape
                    </button>
                    <button className="btn" onClick={() => jumpStep(1)} title="Étape suivante (↓)">
                      Étape ›
                    </button>
                  </>
                )}
                <span className="sep" />
                {clip.kind === 'video' && (
                  <button className="btn" onClick={() => setMuted((m) => !m)} title="Son">
                    {muted ? 'Son coupé' : 'Son'}
                  </button>
                )}
                {clip.kind === 'video' && (
                  <label className="fps" title="Images par seconde (détectées automatiquement à la lecture)">
                    <select
                      value={fpsAuto ? 'auto' : String(fps)}
                      onChange={(e) => {
                        if (e.target.value === 'auto') setFpsAuto(true)
                        else {
                          setFpsAuto(false)
                          setFps(Number(e.target.value))
                        }
                      }}
                    >
                      <option value="auto">auto ({fps} i/s)</option>
                      {[12, 15, 24, 25, 30, 48, 50, 60].map((f) => (
                        <option key={f} value={f}>
                          {f} i/s
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
          </section>

          <aside className="steps">
            <div className="steps-head">
              <h2>Décomposition</h2>
              {steps.length > 0 && <span className="dim">{steps.length} étape{steps.length > 1 ? 's' : ''}</span>}
            </div>
            {steps.length === 0 ? (
              <p className="hint">
                Avance image par image et touche « + Étape » à chaque position clé du mouvement (appui, impulsion,
                rotation, réception…). Tu obtiens une planche à étudier.
              </p>
            ) : (
              <ol className="step-list">
                {steps.map((s, i) => {
                  const active = Math.abs(s.t - t) < 0.5 / fps
                  return (
                    <li key={s.id} className={active ? 'active' : ''}>
                      <button
                        className="thumb"
                        onClick={() => {
                          if (playing) pause()
                          seek(s.t)
                        }}
                        title="Aller à cette étape"
                      >
                        {s.thumb ? <img src={s.thumb} alt="" /> : <span className="no-thumb" />}
                        <span className="num">{i + 1}</span>
                      </button>
                      <div className="step-body">
                        <input
                          value={s.label}
                          placeholder={`Étape ${i + 1} : que se passe-t-il ?`}
                          onChange={(e) =>
                            setSteps((all) => all.map((x) => (x.id === s.id ? { ...x, label: e.target.value } : x)))
                          }
                        />
                        <div className="step-meta">
                          <span>{fmt(s.t)}</span>
                          <button
                            className="link"
                            onClick={() => setSteps((all) => all.filter((x) => x.id !== s.id))}
                          >
                            Supprimer
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
            {steps.some((s) => s.thumb) && (
              <button
                className="btn wide"
                onClick={() =>
                  exportSheet(
                    clip.name,
                    steps.map((s, i) => ({ ...s, label: s.label || `Étape ${i + 1}` })),
                  )
                }
              >
                Exporter la planche (PNG)
              </button>
            )}
            <details className="keys">
              <summary>Raccourcis clavier</summary>
              <dl>
                <dt>Espace</dt><dd>lecture / pause</dd>
                <dt>← →</dt><dd>image par image</dd>
                <dt>⇧ ← →</dt><dd>±1 seconde</dd>
                <dt>J / L</dt><dd>lecture arrière / avant</dd>
                <dt>- / +</dt><dd>vitesse</dd>
                <dt>[ / ]</dt><dd>début / fin de boucle</dd>
                <dt>S</dt><dd>ajouter une étape</dd>
                <dt>↑ ↓</dt><dd>étape précédente / suivante</dd>
                <dt>M</dt><dd>miroir</dd>
                <dt>P</dt><dd>squelette</dd>
                <dt>Molette</dt><dd>zoom</dd>
                <dt>0</dt><dd>réinitialiser le zoom</dd>
                <dt>Clic sur l’image</dt><dd>lecture / pause</dd>
              </dl>
            </details>
          </aside>
        </main>
      )}

      {dragging && <div className="drop-overlay">Dépose ta vidéo ou ton GIF</div>}
      {loading && <div className="loading">Chargement…</div>}
    </div>
  )
}

function Timeline(props: {
  duration: number
  t: number
  a: number | null
  b: number | null
  steps: Step[]
  pct: (x: number) => number
  /** zone dont les images sont prêtes (curseur fluide) */
  cached: [number, number] | null
  onScrubStart: () => void
  onScrub: (t: number) => void
  onScrubEnd: () => void
  onJump: (t: number) => void
}) {
  const { duration, t, a, b, steps, pct } = props
  const ref = useRef<HTMLDivElement>(null)
  const active = useRef(false)
  const left = pct(a ?? 0)
  const right = pct(b ?? duration)
  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return clamp((clientX - r.left) / r.width, 0, 1) * duration
  }
  const end = () => {
    if (!active.current) return
    active.current = false
    props.onScrubEnd()
  }
  return (
    <div
      className="timeline"
      ref={ref}
      role="slider"
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={t}
      onPointerDown={(e) => {
        try {
          ref.current!.setPointerCapture(e.pointerId)
        } catch {
          /* pas de capture possible : on suit quand même le doigt */
        }
        active.current = true
        props.onScrubStart()
        props.onScrub(timeAt(e.clientX))
      }}
      onPointerMove={(e) => {
        if (active.current) props.onScrub(timeAt(e.clientX))
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="track">
        {props.cached && (
          <div
            className="cached"
            style={{ left: `${pct(props.cached[0])}%`, width: `${Math.max(0, pct(props.cached[1]) - pct(props.cached[0]))}%` }}
          />
        )}
        {(a !== null || b !== null) && (
          <div className="loop-range" style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }} />
        )}
        <div className="progress" style={{ width: `${pct(t)}%` }} />
      </div>
      <div className="handle" style={{ left: `${pct(t)}%` }} />
      {steps.map((s, i) => (
        <button
          key={s.id}
          className="marker"
          style={{ left: `${pct(s.t)}%` }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => props.onJump(s.t)}
          title={s.label || `Étape ${i + 1}`}
        >
          {i + 1}
        </button>
      ))}
    </div>
  )
}

function Welcome(props: {
  loading: boolean
  url: string
  setUrl: (u: string) => void
  onPick: () => void
  onUrl: () => void
  library: LibEntry[]
  onOpen: (key: string) => void
  onRename: (key: string, title: string) => void
  onDelete: (key: string, title: string) => void
}) {
  const lib = props.library
  return (
    <main className="welcome">
      {lib.length > 0 && (
        <section className="library">
          <h2>Mes mouvements</h2>
          <ul>
            {lib.map((e) => {
              const n = loadSaved(e.key)?.steps.length ?? 0
              return (
                <li key={e.key}>
                  <button className="lib-open" onClick={() => props.onOpen(e.key)}>
                    {e.thumb ? <img src={e.thumb} alt="" /> : <span className="lib-empty" />}
                    <span className="lib-title">{e.title}</span>
                    <span className="lib-meta">
                      {n ? `${n} étape${n > 1 ? 's' : ''}` : 'pas encore décomposé'} ·{' '}
                      {new Date(e.updated).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                    </span>
                  </button>
                  <div className="lib-actions">
                    <button className="link" onClick={() => props.onRename(e.key, e.title)}>
                      Renommer
                    </button>
                    <button className="link" onClick={() => props.onDelete(e.key, e.title)}>
                      Supprimer
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <div className="hero">
        <h1>Décompose le mouvement.</h1>
        <p>
          Importe une vidéo ou un GIF (capoeira, acrobatie, danse…), ralentis jusqu’à 0,1×, avance image par image,
          reviens en arrière, boucle un passage et note chaque étape du geste.
        </p>
        <button className="drop" onClick={props.onPick}>
          <strong>Choisir une vidéo ou un GIF</strong>
          <span>ou glisse-dépose / colle le fichier ici</span>
        </button>
        <form
          className="url-form"
          onSubmit={(e) => {
            e.preventDefault()
            props.onUrl()
          }}
        >
          <input
            type="url"
            placeholder="…ou colle un lien direct vers un .mp4 / .gif"
            value={props.url}
            onChange={(e) => props.setUrl(e.target.value)}
          />
          <button className="btn" disabled={!props.url || props.loading}>
            Ouvrir
          </button>
        </form>
        <p className="privacy">
          Tes vidéos et ta décomposition sont gardées sur cet appareil, rien n’est envoyé sur un serveur. Seul le
          modèle de détection du squelette est téléchargé, une fois, si tu l’actives.
        </p>
      </div>

      <div className="tips">
        <h2>Récupérer une vidéo Instagram ou Pinterest</h2>
        <ul>
          <li>
            <strong>Tes propres vidéos ou celles enregistrées</strong> : sur téléphone, « Enregistrer » / « Télécharger »
            depuis le menu ⋯ quand c’est proposé, puis importe-la depuis ta galerie.
          </li>
          <li>
            <strong>Enregistrement d’écran</strong> : marche partout (iPhone : Centre de contrôle → Enregistrer l’écran).
            Recadre si besoin, puis importe.
          </li>
          <li>
            <strong>Sur ordinateur</strong> : un outil comme <code>yt-dlp</code> télécharge la vidéo d’un lien de post
            public : <code>yt-dlp "https://www.instagram.com/reel/…"</code>
          </li>
        </ul>
        <p className="dim">
          Garde ces vidéos pour ton usage perso et respecte le travail des créateurs : cite-les si tu partages ta
          décomposition.
        </p>
      </div>
    </main>
  )
}
