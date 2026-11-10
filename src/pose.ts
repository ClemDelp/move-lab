import type { PoseLandmarker } from '@mediapipe/tasks-vision'

/** Point du squelette, coordonnées normalisées (0–1) dans l'image. */
export interface Pt {
  x: number
  y: number
  v: number
}
export type Pose = Pt[]

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm'
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task'

let loading: Promise<PoseLandmarker> | null = null

/** Charge le modèle une seule fois (≈ 10 Mo, mis en cache par le navigateur). */
export function loadPoseModel(): Promise<PoseLandmarker> {
  loading ??= (async () => {
    // chargé à la demande : la librairie n'alourdit pas le démarrage de l'app
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
    const fileset = await FilesetResolver.forVisionTasks(WASM)
    const opts = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'IMAGE' as const,
      numPoses: 1,
      minPoseDetectionConfidence: 0.4,
      minPosePresenceConfidence: 0.4,
    })
    try {
      return await PoseLandmarker.createFromOptions(fileset, opts('GPU'))
    } catch {
      return await PoseLandmarker.createFromOptions(fileset, opts('CPU'))
    }
  })()
  loading.catch(() => (loading = null))
  return loading
}

const work = document.createElement('canvas')
const workCtx = work.getContext('2d', { willReadFrequently: true })!

/**
 * Détecte le squelette sur l'image affichée. Si rien n'est trouvé, réessaie
 * sur l'image retournée à 180° : le détecteur repère mal les corps à l'envers
 * (ATR, bananeira, aú…).
 */
export function detectPose(model: PoseLandmarker, src: CanvasImageSource, w: number, h: number): Pose | null {
  const scale = Math.min(1, 640 / Math.max(w, h))
  work.width = Math.round(w * scale)
  work.height = Math.round(h * scale)

  for (const flipped of [false, true]) {
    workCtx.setTransform(1, 0, 0, 1, 0, 0)
    if (flipped) workCtx.setTransform(-1, 0, 0, -1, work.width, work.height)
    workCtx.drawImage(src, 0, 0, work.width, work.height)
    const res = model.detect(work)
    const lm = res.landmarks[0]
    if (lm?.length) {
      return lm.map((p) => ({
        x: flipped ? 1 - p.x : p.x,
        y: flipped ? 1 - p.y : p.y,
        v: p.visibility ?? 1,
      }))
    }
  }
  return null
}

/* ---------- angles ---------- */

export const JOINTS = [
  { key: 'genou', label: 'Genou', l: [23, 25, 27], r: [24, 26, 28] },
  { key: 'hanche', label: 'Hanche', l: [11, 23, 25], r: [12, 24, 26] },
  { key: 'coude', label: 'Coude', l: [11, 13, 15], r: [12, 14, 16] },
  { key: 'epaule', label: 'Épaule', l: [13, 11, 23], r: [14, 12, 24] },
] as const

export type Angles = Record<string, { l: number | null; r: number | null }>

const MIN_VIS = 0.5

/** Angle (en degrés) au point b, entre les segments b→a et b→c. */
function angleAt(p: Pose, [a, b, c]: readonly number[], w: number, h: number): number | null {
  const A = p[a]
  const B = p[b]
  const C = p[c]
  if (!A || !B || !C || Math.min(A.v, B.v, C.v) < MIN_VIS) return null
  const v1 = [(A.x - B.x) * w, (A.y - B.y) * h]
  const v2 = [(C.x - B.x) * w, (C.y - B.y) * h]
  const n = Math.hypot(...v1) * Math.hypot(...v2)
  if (!n) return null
  const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / n
  return Math.round((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI)
}

export function computeAngles(p: Pose, w: number, h: number): Angles {
  const out: Angles = {}
  for (const j of JOINTS) out[j.key] = { l: angleAt(p, j.l, w, h), r: angleAt(p, j.r, w, h) }
  return out
}

export function formatAngles(a: Angles): string[] {
  return JOINTS.filter((j) => a[j.key]?.l != null || a[j.key]?.r != null).map(
    (j) => `${j.label} G ${a[j.key].l ?? '–'}° · D ${a[j.key].r ?? '–'}°`,
  )
}

/* ---------- dessin ---------- */

// côté gauche du corps (de la personne) en orange, côté droit en bleu
const LEFT = '#ffb547'
const RIGHT = '#5cc8ff'
const CENTER = '#f2f2f3'
const isLeft = (i: number) => i >= 11 && i % 2 === 1
const colorOf = (i: number) => (isLeft(i) ? LEFT : RIGHT)

const BONES: [number, number][] = [
  [11, 12], [23, 24], [11, 23], [12, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [15, 17], [15, 19], [15, 21], [16, 18], [16, 20], [16, 22],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
]

/**
 * Dessine le squelette et les angles. `mirror` : la toile sera retournée en
 * CSS, on retourne donc le texte pour qu'il reste lisible.
 */
export function drawPose(ctx: CanvasRenderingContext2D, p: Pose, w: number, h: number, mirror: boolean) {
  ctx.clearRect(0, 0, w, h)
  const unit = Math.max(w, h) / 400
  const P = (i: number) => [p[i].x * w, p[i].y * h] as const
  const ok = (i: number) => p[i] && p[i].v >= MIN_VIS

  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(2, 2.2 * unit)
  for (const [a, b] of BONES) {
    if (!ok(a) || !ok(b)) continue
    ctx.strokeStyle = isLeft(a) === isLeft(b) ? colorOf(a) : CENTER
    ctx.beginPath()
    ctx.moveTo(...P(a))
    ctx.lineTo(...P(b))
    ctx.stroke()
  }
  // tête : point au nez
  if (ok(0)) {
    ctx.fillStyle = CENTER
    ctx.beginPath()
    ctx.arc(...P(0), Math.max(3, 3 * unit), 0, Math.PI * 2)
    ctx.fill()
  }
  for (let i = 11; i <= 28; i++) {
    if (!ok(i)) continue
    ctx.fillStyle = '#111214'
    ctx.strokeStyle = colorOf(i)
    ctx.lineWidth = Math.max(1.5, 1.5 * unit)
    ctx.beginPath()
    ctx.arc(...P(i), Math.max(3, 3 * unit), 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  // angles aux genoux, hanches, coudes, épaules
  const angles = computeAngles(p, w, h)
  const fs = Math.max(11, Math.round(9 * unit))
  ctx.font = `700 ${fs}px system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  for (const j of JOINTS) {
    for (const side of ['l', 'r'] as const) {
      const deg = angles[j.key][side]
      if (deg == null) continue
      const [x, y] = P(j[side][1])
      const text = `${deg}°`
      const tw = ctx.measureText(text).width
      ctx.save()
      ctx.translate(x, y)
      if (mirror) ctx.scale(-1, 1)
      // étiquette décalée à côté de l'articulation
      const bx = 8 * unit
      ctx.fillStyle = 'rgba(17,18,20,0.78)'
      ctx.beginPath()
      ctx.roundRect(bx - 3 * unit, -fs * 0.7, tw + 6 * unit, fs * 1.4, 3 * unit)
      ctx.fill()
      ctx.fillStyle = side === 'l' ? LEFT : RIGHT
      ctx.fillText(text, bx, 0)
      ctx.restore()
    }
  }
}
