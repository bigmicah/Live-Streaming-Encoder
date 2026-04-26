import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const existing = await db.inputSource.findUnique({ where: { id: params.id } })
    if (!existing) {
      return NextResponse.json({ error: 'Input source not found' }, { status: 404 })
    }
    await db.inputSource.delete({ where: { id: params.id } })
    return NextResponse.json({ message: 'Deleted' })
  } catch (error) {
    console.error('Error deleting input source:', error)
    return NextResponse.json({ error: 'Failed to delete input source' }, { status: 500 })
  }
}
