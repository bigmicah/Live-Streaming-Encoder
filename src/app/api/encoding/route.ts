import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { db } from '@/lib/db'
import { streamingEncoder } from '@/lib/services/streaming-encoder'
import type { FFmpegOptions } from '@/lib/services/streaming-encoder'

export async function GET() {
  try {
    const encodingSessions = await db.encodingSession.findMany({
      include: {
        stream: {
          select: {
            id: true,
            name: true,
            inputUrl: true,
            outputUrl: true,
          },
        },
      },
      orderBy: { startTime: 'desc' },
    })
    return NextResponse.json(encodingSessions)
  } catch (error) {
    console.error('Error fetching encoding sessions:', error)
    return NextResponse.json({ error: 'Failed to fetch encoding sessions' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { streamId } = await request.json()

    if (!streamId) {
      return NextResponse.json({ error: 'Stream ID is required' }, { status: 400 })
    }

    const stream = await db.stream.findUnique({ where: { id: streamId } })
    if (!stream) {
      return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
    }

    const activeSession = await db.encodingSession.findFirst({
      where: { streamId, status: { in: ['STARTING', 'RUNNING'] } },
    })
    if (activeSession) {
      return NextResponse.json({ error: 'Stream is already being encoded' }, { status: 400 })
    }

    // Read system settings for HLS tuning; fall back to env/defaults
    const settings = await db.systemSettings.findFirst()
    const hlsBase = process.env.HLS_OUTPUT_DIR ?? path.join(process.cwd(), 'public', 'hls')
    const outputDirectory = path.join(hlsBase, stream.id)

    const encodingSession = await db.encodingSession.create({
      data: { streamId, status: 'STARTING' },
      include: { stream: true },
    })

    await db.stream.update({ where: { id: streamId }, data: { status: 'ENCODING' } })

    const options: FFmpegOptions = {
      inputUrl: stream.inputUrl,
      outputUrl: stream.outputUrl,
      outputDirectory,
      bitrate: stream.bitrate,
      resolution: stream.resolution,
      preset: stream.encoderPreset,
      gopSize: stream.gopSize,
      bFrames: stream.bFrames,
      profile: stream.profile,
      chroma: stream.chroma,
      aspectRatio: stream.aspectRatio,
      keyframeInterval: stream.keyframeInterval,
      pcr: stream.pcr,
      audioCodec: stream.audioCodec,
      audioBitrate: stream.audioBitrate,
      audioLKFS: stream.audioLKFS,
      audioSampleRate: stream.audioSampleRate,
      scte35Enabled: stream.scte35Enabled,
      scte35Pid: stream.scte35Pid,
      nullPid: stream.nullPid,
      latency: stream.latency,
      hlsTime: settings?.hlsTime ?? parseInt(process.env.HLS_SEGMENT_DURATION ?? '6'),
      hlsListSize: settings?.hlsListSize ?? parseInt(process.env.HLS_PLAYLIST_SIZE ?? '10'),
      hlsFlags: settings?.hlsFlags ?? 'delete_segments+append_list',
    }

    // Start FFmpeg asynchronously — don't await so the response returns quickly
    streamingEncoder.startEncoding(stream.id, encodingSession.id, options).catch((err) => {
      console.error('FFmpeg start error:', err)
    })

    return NextResponse.json(encodingSession, { status: 201 })
  } catch (error) {
    console.error('Error creating encoding session:', error)
    return NextResponse.json({ error: 'Failed to create encoding session' }, { status: 500 })
  }
}
