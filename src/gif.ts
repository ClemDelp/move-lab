import { decompressFrames, parseGIF } from 'gifuct-js'

export interface DecodedGif {
  width: number
  height: number
  frames: ImageData[]
  /** début de chaque image, en secondes */
  starts: number[]
  duration: number
}

/** Décode un GIF animé en images complètes (gère la disposition des calques). */
export function decodeGif(buffer: ArrayBuffer): DecodedGif {
  const gif = parseGIF(buffer)
  const raw = decompressFrames(gif, true)
  const width = gif.lsd.width
  const height = gif.lsd.height

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const patchCanvas = document.createElement('canvas')
  const patchCtx = patchCanvas.getContext('2d')!

  const frames: ImageData[] = []
  const starts: number[] = []
  let t = 0
  let previous: ImageData | null = null

  for (const f of raw) {
    const { top, left, width: w, height: h } = f.dims
    if (f.disposalType === 3) previous = ctx.getImageData(0, 0, width, height)

    patchCanvas.width = w
    patchCanvas.height = h
    const patch = new ImageData(new Uint8ClampedArray(f.patch), w, h)
    patchCtx.putImageData(patch, 0, 0)
    ctx.drawImage(patchCanvas, left, top)

    frames.push(ctx.getImageData(0, 0, width, height))
    starts.push(t)
    // comme les navigateurs : un délai < 20 ms est joué à 100 ms
    const delay = f.delay < 20 ? 100 : f.delay
    t += delay / 1000

    if (f.disposalType === 2) ctx.clearRect(left, top, w, h)
    else if (f.disposalType === 3 && previous) ctx.putImageData(previous, 0, 0)
  }

  return { width, height, frames, starts, duration: t }
}

/** Index de l'image affichée au temps t. */
export function gifFrameAt(gif: DecodedGif, t: number): number {
  const s = gif.starts
  let lo = 0
  let hi = s.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (s[mid] <= t + 1e-6) lo = mid
    else hi = mid - 1
  }
  return lo
}
