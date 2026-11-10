export interface SheetStep {
  t: number
  label: string
  thumb: string | null
  /** lignes d'angles (genou, hanche…) */
  lines?: string[]
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/** Génère une planche PNG des étapes (les positions clés du mouvement) et la télécharge. */
export async function exportSheet(title: string, steps: SheetStep[]) {
  const withThumb = steps.filter((s) => s.thumb)
  if (!withThumb.length) return
  const imgs = await Promise.all(withThumb.map((s) => loadImage(s.thumb!)))

  const cellW = 320
  const ratio = imgs[0].height / imgs[0].width
  const cellH = Math.round(cellW * ratio)
  const maxLines = Math.max(0, ...withThumb.map((s) => s.lines?.length ?? 0))
  const labelH = 52 + maxLines * 17
  const gap = 16
  const header = 64
  const cols = Math.min(4, imgs.length)
  const rows = Math.ceil(imgs.length / cols)

  const canvas = document.createElement('canvas')
  canvas.width = gap + cols * (cellW + gap)
  canvas.height = header + rows * (cellH + labelH + gap) + gap
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#111214'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = '#f2f2f3'
  ctx.font = '600 22px system-ui, sans-serif'
  ctx.fillText(title, gap, 40)
  ctx.fillStyle = '#8b8d94'
  ctx.font = '14px system-ui, sans-serif'
  const sub = 'Move Lab · décomposition'
  ctx.fillText(sub, canvas.width - gap - ctx.measureText(sub).width, 40)

  withThumb.forEach((s, i) => {
    const x = gap + (i % cols) * (cellW + gap)
    const y = header + Math.floor(i / cols) * (cellH + labelH + gap)
    ctx.drawImage(imgs[i], x, y, cellW, cellH)

    ctx.fillStyle = '#ffb547'
    ctx.beginPath()
    ctx.arc(x + 18, y + 18, 13, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#111214'
    ctx.font = '700 14px system-ui, sans-serif'
    const n = String(i + 1)
    ctx.fillText(n, x + 18 - ctx.measureText(n).width / 2, y + 23)

    ctx.fillStyle = '#f2f2f3'
    ctx.font = '600 15px system-ui, sans-serif'
    ctx.fillText(s.label.slice(0, 38), x, y + cellH + 22)
    ctx.fillStyle = '#8b8d94'
    ctx.font = '13px system-ui, sans-serif'
    ctx.fillText(`${s.t.toFixed(2)} s`, x, y + cellH + 41)
    ctx.font = '12px system-ui, sans-serif'
    s.lines?.forEach((line, k) => ctx.fillText(line, x, y + cellH + 60 + k * 17))
  })

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) return
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${title.replace(/\.[^.]+$/, '')}-decomposition.png`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
