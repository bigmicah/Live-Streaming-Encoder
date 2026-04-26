import { NextResponse } from 'next/server'
import os from 'os'
import { promises as fsp } from 'fs'
import { db } from '@/lib/db'

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export async function GET() {
  try {
    // CPU — load-average based percentage
    const loadAvg = os.loadavg()[0]
    const numCores = os.cpus().length
    const cpuPercent = Math.min(Math.round((loadAvg / numCores) * 100), 100)

    // Memory
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const memPercent = Math.round(((totalMem - freeMem) / totalMem) * 100)
    const memUsedMB = Math.round((totalMem - freeMem) / 1024 / 1024)
    const memTotalMB = Math.round(totalMem / 1024 / 1024)

    // Disk — fs.statfs available in Node 18.15+
    let diskPercent = 0
    let diskUsedGB = 0
    let diskTotalGB = 0
    try {
      const stats = await (fsp as any).statfs('/')
      const total = stats.blocks * stats.bsize
      const free = stats.bfree * stats.bsize
      diskPercent = Math.round(((total - free) / total) * 100)
      diskUsedGB = Math.round((total - free) / 1e9 * 10) / 10
      diskTotalGB = Math.round(total / 1e9 * 10) / 10
    } catch {
      // statfs unavailable on this platform — leave zeros
    }

    // Stream counts from DB
    const [totalStreams, activeStreams] = await Promise.all([
      db.stream.count(),
      db.stream.count({ where: { status: 'ENCODING' } }),
    ])

    const uptimeSeconds = process.uptime()

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      uptimeSeconds,
      uptime: formatUptime(uptimeSeconds),
      cpu: {
        percent: cpuPercent,
        cores: numCores,
        loadAvg: os.loadavg(),
      },
      memory: {
        percent: memPercent,
        usedMB: memUsedMB,
        totalMB: memTotalMB,
      },
      disk: {
        percent: diskPercent,
        usedGB: diskUsedGB,
        totalGB: diskTotalGB,
      },
      streams: {
        active: activeStreams,
        total: totalStreams,
      },
      services: {
        api: 'running',
        database: 'connected',
        websocket: 'running',
        encoder: 'ready',
      },
    })
  } catch (error) {
    console.error('Health check error:', error)
    return NextResponse.json(
      { status: 'unhealthy', error: String(error), timestamp: new Date().toISOString() },
      { status: 500 }
    )
  }
}
