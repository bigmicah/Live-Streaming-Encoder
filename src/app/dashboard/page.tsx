'use client'

import { useState, useEffect, useCallback } from 'react'
import { MainLayout } from '@/components/layout/main-layout'
import { Header } from '@/components/layout/header'
import { Breadcrumb } from '@/components/layout/breadcrumb'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Plus,
  BarChart3,
  AlertTriangle,
  CheckCircle,
  Clock,
  Activity,
  Zap,
  Film,
  Radio,
  Monitor,
  Calendar,
  Database,
  Settings,
  Info,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface HealthData {
  uptimeSeconds: number
  uptime: string
  cpu: { percent: number; cores: number }
  memory: { percent: number; usedMB: number; totalMB: number }
  disk: { percent: number; usedGB: number; totalGB: number }
  streams: { active: number; total: number }
}

interface EncodingSession {
  id: string
  status: string
  startTime: string
  outputBytes: number
}

interface Stream {
  id: string
  name: string
  status: string
  inputUrl: string
  outputUrl: string
  bitrate: number
  resolution: string
  encodingSessions: EncodingSession[]
}

interface LogEntry {
  id: string
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  message: string
  component: string | null
  createdAt: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  return `${bytes} B`
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins > 0) return `${mins}m ago`
  return 'just now'
}

function sessionUptime(startTime: string): string {
  return formatUptime(Math.floor((Date.now() - new Date(startTime).getTime()) / 1000))
}

function alertType(level: string): 'warning' | 'error' | 'info' | 'success' {
  if (level === 'ERROR') return 'error'
  if (level === 'WARN') return 'warning'
  if (level === 'INFO') return 'info'
  return 'info'
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const breadcrumbItems = [{ label: 'Dashboard' }]

  const [health, setHealth] = useState<HealthData | null>(null)
  const [streams, setStreams] = useState<Stream[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [healthRes, streamsRes, logsRes] = await Promise.all([
        fetch('/api/health'),
        fetch('/api/streams'),
        fetch('/api/logs?limit=6'),
      ])
      if (healthRes.ok) setHealth(await healthRes.json())
      if (streamsRes.ok) setStreams(await streamsRes.json())
      if (logsRes.ok) {
        const data = await logsRes.json()
        setLogs(data.logs ?? [])
      }
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Dashboard fetch error:', err)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 10000)
    return () => clearInterval(id)
  }, [fetchData])

  // Computed stats
  const activeChannels = streams.filter(s => s.status === 'ENCODING')
  const totalDataBytes = streams.reduce((acc, s) => acc + (s.encodingSessions[0]?.outputBytes ?? 0), 0)

  const quickStats = [
    {
      title: 'Active Channels',
      value: health ? String(health.streams.active) : '—',
      sub: health ? `of ${health.streams.total} total` : '',
      icon: Radio,
      color: 'text-blue-400',
    },
    {
      title: 'Total Streams',
      value: health ? String(health.streams.total) : '—',
      sub: 'configured',
      icon: Database,
      color: 'text-purple-400',
    },
    {
      title: 'Data Processed',
      value: formatBytes(totalDataBytes),
      sub: 'this session',
      icon: Activity,
      color: 'text-green-400',
    },
    {
      title: 'Uptime',
      value: health ? health.uptime : '—',
      sub: 'process uptime',
      icon: Clock,
      color: 'text-emerald-400',
    },
  ]

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <Breadcrumb items={breadcrumbItems} />
            <Header
              title="Dashboard"
              subtitle="Monitor and manage your live streaming channels"
            />
          </div>
          {lastUpdated && (
            <p className="text-xs text-gray-500 pb-1">
              Updated {timeAgo(lastUpdated.toISOString())}
            </p>
          )}
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickStats.map((stat, i) => (
            <Card key={i} className="aws-metric-card">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-400">{stat.title}</p>
                    <p className="text-2xl font-bold text-white">{stat.value}</p>
                    <p className="text-xs text-gray-500">{stat.sub}</p>
                  </div>
                  <stat.icon className={`h-8 w-8 ${stat.color}`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* System Health */}
          <Card className="lg:col-span-2 aws-metric-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <Activity className="h-5 w-5 text-orange-400" />
                System Health
              </CardTitle>
              <CardDescription className="text-gray-400">
                Real-time resource utilization
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {health ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">CPU Usage</span>
                        <span className="text-white">{health.cpu.percent}%</span>
                      </div>
                      <Progress value={health.cpu.percent} className="h-2 aws-progress-bar" />
                      <p className="text-xs text-gray-500">{health.cpu.cores} cores · load avg {health.cpu.loadAvg?.[0]?.toFixed(2) ?? '—'}</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">Memory</span>
                        <span className="text-white">{health.memory.percent}%</span>
                      </div>
                      <Progress value={health.memory.percent} className="h-2 aws-progress-bar" />
                      <p className="text-xs text-gray-500">{health.memory.usedMB} MB / {health.memory.totalMB} MB</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">Disk Usage</span>
                        <span className="text-white">{health.disk.percent}%</span>
                      </div>
                      <Progress value={health.disk.percent} className="h-2 aws-progress-bar" />
                      <p className="text-xs text-gray-500">{health.disk.usedGB} GB / {health.disk.totalGB} GB</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">Active Channels</span>
                        <span className="text-white">{health.streams.active}/{health.streams.total}</span>
                      </div>
                      <Progress
                        value={health.streams.total > 0 ? (health.streams.active / health.streams.total) * 100 : 0}
                        className="h-2 aws-progress-bar"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-gray-700">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full aws-status-online" />
                      <span className="text-sm font-medium text-white">System Healthy</span>
                    </div>
                    <span className="text-sm text-gray-400">Uptime: {health.uptime}</span>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-gray-500">Loading health data…</div>
              )}
            </CardContent>
          </Card>

          {/* Recent Alerts */}
          <Card className="aws-alert-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <AlertTriangle className="h-5 w-5 text-orange-400" />
                Recent Alerts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {logs.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No recent events</p>
              ) : (
                logs.map(log => {
                  const type = alertType(log.level)
                  return (
                    <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg border border-gray-700">
                      <div className={`mt-0.5 shrink-0 ${
                        type === 'error'   ? 'text-red-400' :
                        type === 'warning' ? 'text-yellow-400' :
                        type === 'success' ? 'text-green-400' :
                        'text-blue-400'
                      }`}>
                        {type === 'error' || type === 'warning'
                          ? <AlertTriangle className="h-4 w-4" />
                          : type === 'success'
                          ? <CheckCircle className="h-4 w-4" />
                          : <Info className="h-4 w-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{log.message}</p>
                        <p className="text-xs text-gray-400">
                          {log.component && <span className="mr-1 text-gray-500">[{log.component}]</span>}
                          {timeAgo(log.createdAt)}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-xs shrink-0 ${
                          log.level === 'ERROR' ? 'border-red-500/30 text-red-400' :
                          log.level === 'WARN'  ? 'border-yellow-500/30 text-yellow-400' :
                          'border-gray-600 text-gray-400'
                        }`}
                      >
                        {log.level}
                      </Badge>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>

        {/* Active Channels */}
        <Card className="aws-channel-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Radio className="h-5 w-5 text-orange-400" />
                  {activeChannels.length > 0 ? 'Active Channels' : 'All Streams'}
                </CardTitle>
                <CardDescription className="text-gray-400">
                  {activeChannels.length > 0
                    ? 'Currently encoding streams'
                    : 'No streams encoding — showing all configured streams'}
                </CardDescription>
              </div>
              <Button className="aws-button-gradient">
                <Plus className="h-4 w-4 mr-2" />
                Create Channel
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {streams.length === 0 ? (
              <p className="text-center py-8 text-gray-500">
                No streams configured yet. Create a stream to get started.
              </p>
            ) : (
              <div className="space-y-4">
                {(activeChannels.length > 0 ? activeChannels : streams).map(stream => {
                  const session = stream.encodingSessions[0]
                  const isEncoding = stream.status === 'ENCODING'
                  return (
                    <div key={stream.id} className="flex items-center justify-between p-4 border border-gray-700 rounded-lg">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <div className={`h-2 w-2 rounded-full ${
                            isEncoding        ? 'aws-status-online' :
                            stream.status === 'ERROR' ? 'bg-red-500' :
                            'bg-gray-500'
                          }`} />
                          <div>
                            <h3 className="font-medium text-white">{stream.name}</h3>
                            <p className="text-xs text-gray-500 truncate max-w-[160px]">{stream.id}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <div className="flex items-center gap-1">
                            <Monitor className="h-4 w-4 text-gray-400" />
                            <span className="text-gray-300 truncate max-w-[120px]">{stream.inputUrl}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Zap className="h-4 w-4 text-gray-400" />
                            <span className="text-gray-300">{stream.bitrate} kbps</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Film className="h-4 w-4 text-gray-400" />
                            <span className="text-gray-300">{stream.resolution}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <Badge
                          className={
                            isEncoding        ? 'bg-green-600' :
                            stream.status === 'ERROR'   ? 'bg-red-600' :
                            stream.status === 'STOPPING' ? 'bg-yellow-600' :
                            'bg-gray-600'
                          }
                        >
                          {stream.status}
                        </Badge>
                        {isEncoding && session && (
                          <div className="text-right">
                            <div className="text-sm font-medium text-white">{sessionUptime(session.startTime)}</div>
                            <div className="text-xs text-gray-400">uptime</div>
                          </div>
                        )}
                        {isEncoding && session && session.outputBytes > 0 && (
                          <div className="text-right">
                            <div className="text-sm font-medium text-white">{formatBytes(session.outputBytes)}</div>
                            <div className="text-xs text-gray-400">output</div>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="border-gray-600 text-gray-300 hover:bg-gray-800">
                            <Settings className="h-4 w-4" />
                          </Button>
                          <Button variant="outline" size="sm" className="border-gray-600 text-gray-300 hover:bg-gray-800">
                            <BarChart3 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="aws-metric-card">
          <CardHeader>
            <CardTitle className="text-white">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Button variant="outline" className="h-20 flex-col gap-2 border-gray-600 text-gray-300 hover:bg-gray-800">
                <Plus className="h-6 w-6" />
                <span>Create Channel</span>
              </Button>
              <Button variant="outline" className="h-20 flex-col gap-2 border-gray-600 text-gray-300 hover:bg-gray-800">
                <Calendar className="h-6 w-6" />
                <span>Schedule Event</span>
              </Button>
              <Button variant="outline" className="h-20 flex-col gap-2 border-gray-600 text-gray-300 hover:bg-gray-800">
                <Database className="h-6 w-6" />
                <span>View Logs</span>
              </Button>
              <Button variant="outline" className="h-20 flex-col gap-2 border-gray-600 text-gray-300 hover:bg-gray-800">
                <Settings className="h-6 w-6" />
                <span>Settings</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  )
}
