import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const inputs = await db.inputSource.findMany({ orderBy: { createdAt: 'asc' } })
    return NextResponse.json(inputs)
  } catch (error) {
    console.error('Error fetching input sources:', error)
    return NextResponse.json({ error: 'Failed to fetch input sources' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, type, url, bitrate, resolution } = body

    if (!name || !type || !url) {
      return NextResponse.json({ error: 'name, type, and url are required' }, { status: 400 })
    }

    const input = await db.inputSource.create({
      data: {
        name,
        type,
        url,
        bitrate: bitrate ?? 5000,
        resolution: resolution ?? '1920x1080',
      },
    })

    return NextResponse.json(input, { status: 201 })
  } catch (error) {
    console.error('Error creating input source:', error)
    return NextResponse.json({ error: 'Failed to create input source' }, { status: 500 })
  }
}
