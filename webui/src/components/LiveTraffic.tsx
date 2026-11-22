import { useEffect, useState } from 'react'
import { followStream } from '../api/client'
import { Card, CardHeader } from '../ui'

function amount(value: number | null, rate = false) {
  if (value === null) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let index = 0
  while (value >= 1024 && index < 3) {
    value /= 1024
    index++
  }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}${rate ? '/s' : ''}`
}

export function LiveTraffic({ running }: { running: boolean }) {
  const [traffic, setTraffic] = useState<{
    up: number
    down: number
    upTotal?: number
    downTotal?: number
  } | null>(null)
  const [memory, setMemory] = useState<number | null>(null)
  const [samples, setSamples] = useState<{ up: number; down: number }[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    setTraffic(null)
    setMemory(null)
    setSamples([])
    setError('')
    if (!running) return
    const controller = new AbortController()
    void followStream<{ up: number; down: number; upTotal?: number; downTotal?: number }>(
      'traffic',
      value => {
        setError('')
        setTraffic(value)
        setSamples(current => [...current.slice(-59), value])
      },
      setError,
      controller.signal,
    )
    void followStream<{ inuse: number }>(
      'memory',
      value => setMemory(value.inuse),
      () => {},
      controller.signal,
    )
    return () => controller.abort()
  }, [running])
  const max = Math.max(1, ...samples.flatMap(value => [value.up, value.down]))
  const points = (key: 'up' | 'down') =>
    samples.map((value, index) => `${(index * 100) / 59},${98 - (value[key] / max) * 92}`).join(' ')
  return (
    <Card>
      <CardHeader title="实时流量" description={error || (running ? '最近 60 秒' : '核心未运行')} />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {[
          ['上传速度', amount(traffic?.up ?? null, true)],
          ['下载速度', amount(traffic?.down ?? null, true)],
          ['累计上传', amount(traffic?.upTotal ?? null)],
          ['累计下载', amount(traffic?.downTotal ?? null)],
          ['内存', amount(memory)],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-2 text-base font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="mt-5 h-32 w-full"
        role="img"
        aria-label="上传下载速度趋势"
      >
        <polyline
          points={points('down')}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={points('up')}
          fill="none"
          stroke="hsl(var(--success))"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <p className="text-xs text-muted-foreground">蓝线下载 · 绿线上传</p>
    </Card>
  )
}
