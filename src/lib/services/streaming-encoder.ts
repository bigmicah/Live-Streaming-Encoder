import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import { db } from '@/lib/db'
import { getIO } from '@/lib/io-server'

export interface FFmpegOptions {
  inputUrl: string
  outputUrl: string
  outputDirectory: string
  bitrate: number
  resolution: string
  preset: string
  gopSize: number
  bFrames: number
  profile: string
  chroma: string
  aspectRatio: string
  keyframeInterval: number
  pcr: string
  audioCodec: string
  audioBitrate: number
  audioLKFS: number
  audioSampleRate: number
  scte35Enabled: boolean
  scte35Pid: number
  nullPid: number
  latency: number
  hlsTime: number
  hlsListSize: number
  hlsFlags: string
}

export interface EncodingMetadata {
  streamId: string
  sessionId: string
  startTime: Date
  inputUrl: string
  outputUrl: string
  bitrate: number
  resolution: string
  scte35Enabled: boolean
  ffmpegCommand: string
  pid?: number
  logPath: string
}

const CHROMA_MAP: Record<string, string> = {
  '4:2:0': 'yuv420p',
  '4:2:2': 'yuv422p',
  '4:4:4': 'yuv444p',
}

// Regex to parse FFmpeg progress lines written to stderr:
// frame=  247 fps= 30 q=27.0 size=    4608kB time=00:00:08.23 bitrate=4588.8kbits/s speed=1.00x
const STATS_RE = /frame=\s*(\d+)\s+fps=\s*([\d.]+).*?size=\s*(\d+)kB.*?bitrate=\s*([\d.]+)kbits.*?speed=\s*([\d.]+)x/

export class StreamingEncoder {
  private activeProcesses: Map<string, ChildProcess> = new Map()
  private stoppingIntentionally: Set<string> = new Set()

  async startEncoding(
    streamId: string,
    sessionId: string,
    options: FFmpegOptions
  ): Promise<EncodingMetadata> {
    await fs.mkdir(options.outputDirectory, { recursive: true })

    const { ffmpegPath, args, fullCommand } = this.buildFFmpegCommand(options)
    const logPath = path.join(options.outputDirectory, `encoding_${sessionId}.log`)

    const proc = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    this.activeProcesses.set(sessionId, proc)

    // Write stdout + stderr to log file; parse stderr for stats
    const logStream = (await fs.open(logPath, 'w')).createWriteStream()
    proc.stdout?.pipe(logStream)
    proc.stderr?.on('data', (chunk: Buffer) => {
      logStream.write(chunk)
      this.handleStatsLine(sessionId, streamId, chunk.toString())
    })

    proc.on('exit', (code, signal) =>
      this.handleProcessExit(sessionId, streamId, code, signal)
    )
    proc.on('error', (err) => this.handleProcessError(sessionId, err))

    await db.encodingSession.update({
      where: { id: sessionId },
      data: { status: 'RUNNING', pid: proc.pid, logPath },
    })

    await db.systemLog.create({
      data: {
        level: 'INFO',
        message: `Started encoding session ${sessionId} for stream ${streamId}`,
        component: 'encoder',
        metadata: JSON.stringify({ ffmpegCommand: fullCommand }),
      },
    })

    getIO()?.to('streaming-updates').emit('stream-status-update', {
      streamId,
      status: 'ENCODING',
      timestamp: new Date(),
    })

    return {
      streamId,
      sessionId,
      startTime: new Date(),
      inputUrl: options.inputUrl,
      outputUrl: options.outputUrl,
      bitrate: options.bitrate,
      resolution: options.resolution,
      scte35Enabled: options.scte35Enabled,
      ffmpegCommand: fullCommand,
      pid: proc.pid,
      logPath,
    }
  }

  async stopEncoding(sessionId: string, streamId?: string): Promise<void> {
    const proc = this.activeProcesses.get(sessionId)
    if (proc) {
      this.stoppingIntentionally.add(sessionId)
      proc.kill('SIGTERM')
      // Give FFmpeg 5 s to flush and exit cleanly before forcing it
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.activeProcesses.has(sessionId)) proc.kill('SIGKILL')
          resolve()
        }, 5000)
        proc.once('exit', () => { clearTimeout(timeout); resolve() })
      })
      this.activeProcesses.delete(sessionId)
    }

    await db.encodingSession.update({
      where: { id: sessionId },
      data: { status: 'COMPLETED', endTime: new Date() },
    })

    if (streamId) {
      await db.stream.update({
        where: { id: streamId },
        data: { status: 'IDLE' },
      })
    }

    await db.systemLog.create({
      data: {
        level: 'INFO',
        message: `Stopped encoding session ${sessionId}`,
        component: 'encoder',
      },
    })

    if (streamId) {
      getIO()?.to('streaming-updates').emit('stream-status-update', {
        streamId,
        status: 'IDLE',
        timestamp: new Date(),
      })
    }
  }

  private buildFFmpegCommand(options: FFmpegOptions): {
    ffmpegPath: string
    args: string[]
    fullCommand: string
  } {
    const ffmpegPath = process.env.FFMPEG_PATH ?? '/usr/bin/ffmpeg'
    const args: string[] = ['-y']

    // ── Input ──────────────────────────────────────────────────────────────
    if (options.inputUrl.startsWith('decklink://')) {
      // e.g. decklink://0  →  -f decklink -i "0"
      const device = options.inputUrl.replace('decklink://', '') || '0'
      args.push('-f', 'decklink', '-i', device)
    } else if (
      options.inputUrl.startsWith('rtmp://') &&
      (options.inputUrl.includes('0.0.0.0') ||
        options.inputUrl.includes('localhost') ||
        options.inputUrl.includes('127.0.0.1'))
    ) {
      // Local RTMP: listen for an incoming push
      args.push('-listen', '1', '-i', options.inputUrl)
    } else {
      // SRT (srt://...), remote RTMP, UDP (udp://...) — FFmpeg handles natively
      args.push('-i', options.inputUrl)
    }

    // ── Video ──────────────────────────────────────────────────────────────
    const pixFmt = CHROMA_MAP[options.chroma] ?? 'yuv420p'
    args.push(
      '-c:v', 'libx264',
      '-preset', options.preset || 'fast',
      '-profile:v', options.profile || 'high',
      '-level:v', '4.1',
      '-b:v', `${options.bitrate}k`,
      '-maxrate', `${Math.round(options.bitrate * 1.5)}k`,
      '-bufsize', `${options.bitrate * 2}k`,
      '-s', options.resolution,
      '-r', '30',
      '-g', options.keyframeInterval.toString(),
      '-keyint_min', options.keyframeInterval.toString(),
      '-bf', Math.min(options.bFrames, 2).toString(),
      '-pix_fmt', pixFmt,
      '-sc_threshold', '0'
    )

    // ── Audio ──────────────────────────────────────────────────────────────
    args.push(
      '-c:a', 'aac',
      '-b:a', `${options.audioBitrate}k`,
      '-ar', options.audioSampleRate.toString()
    )

    // ── HLS output ─────────────────────────────────────────────────────────
    const m3u8     = path.join(options.outputDirectory, 'stream.m3u8')
    const segments = path.join(options.outputDirectory, 'segment_%05d.ts')
    args.push(
      '-f', 'hls',
      '-hls_time', options.hlsTime.toString(),
      '-hls_list_size', options.hlsListSize.toString(),
      '-hls_flags', options.hlsFlags || 'delete_segments+append_list',
      '-hls_segment_filename', segments,
      m3u8
    )

    const fullCommand = `${ffmpegPath} ${args.join(' ')}`
    return { ffmpegPath, args, fullCommand }
  }

  private handleStatsLine(sessionId: string, streamId: string, data: string): void {
    const m = data.match(STATS_RE)
    if (!m) return
    const [, frames, fps, sizeKB, bitrateKbps, speed] = m
    getIO()?.to('streaming-updates').emit('encoding-stats', {
      sessionId,
      streamId,
      frames: parseInt(frames),
      fps: parseFloat(fps),
      sizeKB: parseInt(sizeKB),
      bitrateKbps: parseFloat(bitrateKbps),
      speed: parseFloat(speed),
      timestamp: new Date(),
    })
  }

  private async handleProcessExit(
    sessionId: string,
    streamId: string,
    code: number | null,
    signal: string | null
  ): Promise<void> {
    this.activeProcesses.delete(sessionId)
    const intentional = this.stoppingIntentionally.delete(sessionId)
    const status = intentional || code === 0 ? 'COMPLETED' : 'ERROR'

    try {
      await db.encodingSession.update({
        where: { id: sessionId },
        data: { status, endTime: new Date(), progress: 100 },
      })

      await db.stream.update({
        where: { id: streamId },
        data: { status: status === 'ERROR' ? 'ERROR' : 'IDLE' },
      })

      await db.systemLog.create({
        data: {
          level: status === 'ERROR' ? 'ERROR' : 'INFO',
          message: `Encoding session ${sessionId} ${status.toLowerCase()} (code: ${code}, signal: ${signal})`,
          component: 'encoder',
        },
      })

      getIO()?.to('streaming-updates').emit('stream-status-update', {
        streamId,
        status: status === 'ERROR' ? 'ERROR' : 'IDLE',
        timestamp: new Date(),
      })
    } catch (err) {
      console.error('Error handling process exit:', err)
    }
  }

  private async handleProcessError(sessionId: string, error: Error): Promise<void> {
    this.activeProcesses.delete(sessionId)
    this.stoppingIntentionally.delete(sessionId)

    try {
      const session = await db.encodingSession.findUnique({ where: { id: sessionId } })
      if (session) {
        await db.encodingSession.update({
          where: { id: sessionId },
          data: { status: 'ERROR', endTime: new Date() },
        })
        await db.stream.update({
          where: { id: session.streamId },
          data: { status: 'ERROR' },
        })
        getIO()?.to('streaming-updates').emit('stream-status-update', {
          streamId: session.streamId,
          status: 'ERROR',
          timestamp: new Date(),
        })
      }

      await db.systemLog.create({
        data: {
          level: 'ERROR',
          message: `Encoding session ${sessionId} error: ${error.message}`,
          component: 'encoder',
        },
      })
    } catch (err) {
      console.error('Error handling process error:', err)
    }
  }

  async getEncodingStatus(sessionId: string): Promise<{
    status: string
    progress: number
    inputBytes: number
    outputBytes: number
    isRunning: boolean
  }> {
    const session = await db.encodingSession.findUnique({ where: { id: sessionId } })
    if (!session) throw new Error('Encoding session not found')
    return {
      status: session.status,
      progress: session.progress,
      inputBytes: session.inputBytes,
      outputBytes: session.outputBytes,
      isRunning: this.activeProcesses.has(sessionId),
    }
  }

  getActiveSessions(): string[] {
    return Array.from(this.activeProcesses.keys())
  }
}

export const streamingEncoder = new StreamingEncoder()
