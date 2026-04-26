import type { Server } from 'socket.io'

let _io: Server | null = null

export const setIO = (io: Server): void => { _io = io }
export const getIO = (): Server | null => _io
