import { defineConfig } from 'vite'
import net from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'

type MirrorStatus = {
  connected: boolean
  host: string
  port: number
  message: string
}

type MirrorRecord =
  | { kind: 'begin'; messageType: 'snapshot' | 'diff'; appId: string; fieldCount?: number; schemaHash?: number }
  | { kind: 'int'; field: number; value: number }
  | { kind: 'string'; field: number; value: string }
  | { kind: 'array_len'; field: number; len: number }
  | { kind: 'array_int'; field: number; index: number; subfield: number; value: number }
  | { kind: 'scroll'; node: number; scrollY: number }
  | { kind: 'end' }
  | { kind: 'error'; message: string }

const MIRROR_RELAY_DEBUG = process.env.GEA_MIRROR_DEBUG === '1'

function mirrorRelayDebug(message: string) {
  if (MIRROR_RELAY_DEBUG) console.info(message)
}

function describeMirrorRecord(record: MirrorRecord): string {
  if (record.kind === 'begin') {
    const schema =
      record.fieldCount == null && record.schemaHash == null
        ? ''
        : ` fields=${record.fieldCount ?? '?'} schema=0x${(record.schemaHash ?? 0).toString(16)}`
    return `begin type=${record.messageType} app=${record.appId}${schema}`
  }
  if (record.kind === 'int') return `int field=${record.field} value=${record.value}`
  if (record.kind === 'string') return `string field=${record.field} bytes=${record.value.length}`
  if (record.kind === 'array_len') return `array_len field=${record.field} len=${record.len}`
  if (record.kind === 'array_int')
    return `array_int field=${record.field} index=${record.index} subfield=${record.subfield} value=${record.value}`
  if (record.kind === 'scroll') return `scroll node=${record.node} y=${record.scrollY}`
  if (record.kind === 'error') return `error message=${record.message}`
  return 'end'
}

class MirrorRelay {
  private socket: net.Socket | null = null
  private subscribers = new Set<ServerResponse>()
  private frameBuffer = Buffer.alloc(0)
  private status: MirrorStatus = { connected: false, host: '', port: 8081, message: 'Idle' }
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldReconnect = false

  events(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.write('\n')
    this.subscribers.add(res)
    this.send(res, 'status', this.status)
    if (this.shouldReconnect && !this.socket && this.status.host)
      this.scheduleReconnect(this.status.host, this.status.port)
    req.on('close', () => {
      this.subscribers.delete(res)
      if (this.subscribers.size === 0) {
        this.clearReconnectTimer()
        this.disconnect('No mirror viewers')
      }
    })
  }

  connect(host: string, port: number) {
    this.shouldReconnect = true
    this.clearReconnectTimer()
    this.closeSocket()
    this.status = { connected: false, host, port, message: `Connecting to ${host}:${port}...` }
    this.broadcast('status', this.status)

    const socket = net.createConnection({ host, port })
    socket.setKeepAlive(true, 1000)
    socket.setNoDelay(true)
    this.socket = socket
    this.frameBuffer = Buffer.alloc(0)

    socket.on('connect', () => {
      this.status = { connected: true, host, port, message: `Connected to ${host}:${port}` }
      this.broadcast('status', this.status)
      console.info(`[mirror-relay] tx command enable to ${host}:${port}`)
      socket.write(Buffer.from([0x4d])) // DIAG_CMD_ENABLE_MIRROR
    })

    socket.on('data', chunk => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      mirrorRelayDebug(`[mirror-relay] rx ${data.length} byte(s) from ${host}:${port}`)
      this.consume(data)
    })

    socket.on('error', error => {
      if (this.socket !== socket) return
      this.status = { connected: false, host, port, message: error.message }
      this.broadcast('status', this.status)
    })

    socket.on('close', () => {
      if (this.socket !== socket) return
      this.socket = null
      const retrying = this.shouldReconnect && this.subscribers.size > 0
      this.status = {
        connected: false,
        host,
        port,
        message: retrying ? `Disconnected from ${host}:${port}; retrying...` : `Disconnected from ${host}:${port}`
      }
      this.broadcast('status', this.status)
      if (retrying) this.scheduleReconnect(host, port)
    })
  }

  disconnect(message = 'Disconnected') {
    this.shouldReconnect = false
    this.clearReconnectTimer()
    this.closeSocket()
    this.status = { ...this.status, connected: false, message }
    this.broadcast('status', this.status)
  }

  currentStatus() {
    return this.status
  }

  private consume(chunk: Buffer) {
    if (chunk.length === 0) return
    this.frameBuffer = this.frameBuffer.length === 0 ? chunk : Buffer.concat([this.frameBuffer, chunk])
    while (this.frameBuffer.length >= 4) {
      const channel = this.frameBuffer.readUInt8(0)
      const type = this.frameBuffer.readUInt8(1)
      const payloadLen = this.frameBuffer.readUInt16LE(2)
      const frameLen = 4 + payloadLen
      if (this.frameBuffer.length < frameLen) break
      const payload = this.frameBuffer.subarray(4, frameLen)
      this.frameBuffer = this.frameBuffer.subarray(frameLen)
      this.dispatchFrame(channel, type, payload)
    }
  }

  private dispatchFrame(channel: number, _type: number, payload: Buffer) {
    if (channel === 1) {
      mirrorRelayDebug(`[mirror-relay] rx log bytes=${payload.length}`)
      this.broadcastRaw('log', payload.toString('utf8'))
      return
    }
    if (channel !== 2) return
    const records = this.decodeMirrorRecords(payload)
    if (records) {
      for (const record of records)
        mirrorRelayDebug(`[mirror-relay] rx mirror ${describeMirrorRecord(record)} payload=${payload.length}`)
      if (records.length === 1) this.broadcast('mirror', records[0])
      else this.broadcast('mirror-batch', records)
    } else {
      console.warn(`[mirror-relay] rx mirror malformed payload=${payload.length}`)
    }
  }

  private decodeMirrorRecord(payload: Buffer): MirrorRecord | null {
    const decoded = this.decodeMirrorRecordAt(payload, 0)
    return decoded && decoded.nextOffset === payload.length ? decoded.record : null
  }

  private decodeMirrorRecords(payload: Buffer): MirrorRecord[] | null {
    const records: MirrorRecord[] = []
    let offset = 0
    while (offset < payload.length) {
      const decoded = this.decodeMirrorRecordAt(payload, offset)
      if (!decoded) return null
      records.push(decoded.record)
      offset = decoded.nextOffset
    }
    return records.length > 0 ? records : null
  }

  private decodeMirrorRecordAt(payload: Buffer, offset: number): { record: MirrorRecord; nextOffset: number } | null {
    if (payload.length < offset + 1) return null
    const kind = payload.readUInt8(offset)
    if (kind === 1) {
      if (payload.length < offset + 3) return null
      const typeByte = payload.readUInt8(offset + 1)
      const appLen = payload.readUInt8(offset + 2)
      const end = offset + 3 + appLen
      if (payload.length < end) return null
      const record: Extract<MirrorRecord, { kind: 'begin' }> = {
        kind: 'begin',
        messageType: typeByte === 1 ? 'snapshot' : 'diff',
        appId: payload.toString('utf8', offset + 3, end)
      }
      let nextOffset = end
      if (payload.length >= end + 6) {
        record.fieldCount = payload.readUInt16LE(end)
        record.schemaHash = payload.readUInt32LE(end + 2)
        nextOffset = end + 6
      }
      return {
        record,
        nextOffset
      }
    }
    if (kind === 2) {
      if (payload.length < offset + 7) return null
      return {
        record: {
          kind: 'int',
          field: payload.readUInt16LE(offset + 1),
          value: payload.readInt32LE(offset + 3)
        },
        nextOffset: offset + 7
      }
    }
    if (kind === 3) {
      if (payload.length < offset + 5) return null
      const field = payload.readUInt16LE(offset + 1)
      const len = payload.readUInt16LE(offset + 3)
      const end = offset + 5 + len
      if (payload.length < end) return null
      return {
        record: {
          kind: 'string',
          field,
          value: payload.toString('utf8', offset + 5, end)
        },
        nextOffset: end
      }
    }
    if (kind === 4) {
      if (payload.length < offset + 5) return null
      return {
        record: {
          kind: 'array_len',
          field: payload.readUInt16LE(offset + 1),
          len: payload.readUInt16LE(offset + 3)
        },
        nextOffset: offset + 5
      }
    }
    if (kind === 5) {
      if (payload.length < offset + 10) return null
      return {
        record: {
          kind: 'array_int',
          field: payload.readUInt16LE(offset + 1),
          index: payload.readUInt16LE(offset + 3),
          subfield: payload.readUInt8(offset + 5),
          value: payload.readInt32LE(offset + 6)
        },
        nextOffset: offset + 10
      }
    }
    if (kind === 8) {
      if (payload.length < offset + 7) return null
      return {
        record: {
          kind: 'scroll',
          node: payload.readUInt16LE(offset + 1),
          scrollY: payload.readInt32LE(offset + 3)
        },
        nextOffset: offset + 7
      }
    }
    if (kind === 6) return { record: { kind: 'end' }, nextOffset: offset + 1 }
    if (kind === 7) {
      if (payload.length < offset + 2) return null
      const len = payload.readUInt8(offset + 1)
      const end = offset + 2 + len
      if (payload.length < end) return null
      return {
        record: { kind: 'error', message: payload.toString('utf8', offset + 2, end) },
        nextOffset: end
      }
    }
    return null
  }

  private broadcast(event: string, data: unknown) {
    this.broadcastRaw(event, JSON.stringify(data))
  }

  private broadcastRaw(event: string, data: string) {
    for (const res of [...this.subscribers]) this.sendRaw(res, event, data)
  }

  private send(res: ServerResponse, event: string, data: unknown) {
    this.sendRaw(res, event, JSON.stringify(data))
  }

  private sendRaw(res: ServerResponse, event: string, data: string) {
    if (res.destroyed || res.writableEnded) {
      this.subscribers.delete(res)
      return
    }

    try {
      res.write(`event: ${event}\n`)
      for (const line of data.split('\n')) res.write(`data: ${line}\n`)
      res.write('\n')
      if (res.writableLength > 1024 * 1024) {
        this.subscribers.delete(res)
        res.destroy(new Error('Mirror SSE client is not draining'))
      }
    } catch {
      this.subscribers.delete(res)
      res.destroy()
    }
  }

  private closeSocket() {
    if (!this.socket) return
    const socket = this.socket
    this.socket = null
    socket.destroy()
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private scheduleReconnect(host: string, port: number) {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.shouldReconnect && !this.socket && this.subscribers.size > 0) this.connect(host, port)
    }, 1000)
  }
}

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => {
      body += String(chunk)
      if (body.length > 1024 * 1024) reject(new Error('Request body too large'))
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

function installMirrorMiddleware(middlewares: { use: (handler: any) => void }) {
  const relay = new MirrorRelay()
  middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url?.split('?')[0]
    if (url === '/mirror/events' && req.method === 'GET') {
      relay.events(req, res)
      return
    }
    if (url === '/mirror/status' && req.method === 'GET') {
      sendJson(res, 200, relay.currentStatus())
      return
    }
    if (url === '/mirror/disconnect' && req.method === 'POST') {
      relay.disconnect()
      sendJson(res, 200, relay.currentStatus())
      return
    }
    if (url === '/mirror/connect' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req)
        const host = String(body.host || '').trim()
        const port = Number(body.port || 8081)
        if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) {
          sendJson(res, 400, { error: 'Expected host and port' })
          return
        }
        relay.connect(host, Math.round(port))
        sendJson(res, 200, relay.currentStatus())
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    next()
  })
}

export default defineConfig({
  plugins: [
    {
      name: 'gea-device-mirror-relay',
      configureServer(server) {
        installMirrorMiddleware(server.middlewares)
      },
      configurePreviewServer(server) {
        installMirrorMiddleware(server.middlewares)
      }
    }
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
