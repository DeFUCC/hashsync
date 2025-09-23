#!/usr/bin/env node

import { Server } from 'bittorrent-tracker'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createServer } from 'net'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

class GenericWebTorrentServer {
  constructor(options = {}) {
    this.config = {
      port: options.port || process.env.PORT || 8080,
      hostname: options.hostname || process.env.HOST || 'localhost', // Changed from 0.0.0.0
      interval: options.interval || 600000, // 10min - standard BitTorrent interval
      ...options
    }

    this.stats = {
      announces: 0,
      scrapes: 0,
      torrents: 0,
      peers: 0
    }

    this.initTracker()
  }

  initTracker() {
    // Generic tracker - no filtering, embrace the network effect!
    this.tracker = new Server({
      udp: true,   // Support traditional clients
      http: true,  // Support web and traditional clients
      ws: true,    // Primary for PWAs
      stats: false, // We'll handle our own stats
      interval: this.config.interval,
      trustProxy: false
    })

    this.setupEventHandlers()
    this.setupHTTPServer()
  }

  setupEventHandlers() {
    this.tracker.on('error', (err) => {
      console.error('❌ Tracker error:', err.message)
    })

    this.tracker.on('warning', (err) => {
      console.warn('⚠️  Warning:', err.message)
    })

    this.tracker.on('listening', () => {
      const wsAddr = this.tracker.ws?.address()
      const udpAddr = this.tracker.udp?.address()
      const httpAddr = this.tracker.http?.address()

      console.log('🚀 Generic WebTorrent Server running!')
      if (wsAddr) console.log(`📡 WebSocket: ws://${wsAddr.address}:${wsAddr.port}`)
      if (udpAddr) console.log(`📡 UDP: udp://${udpAddr.address}:${udpAddr.port}`)
      if (httpAddr) console.log(`📡 HTTP: http://${httpAddr.address}:${httpAddr.port}/announce`)
      console.log(`🌐 Web Interface: http://localhost:${this.config.port}/share`)
    })

    // Track activity for stats
    this.tracker.on('start', () => { this.stats.announces++; this.updateStats() })
    this.tracker.on('update', () => { this.stats.announces++; this.updateStats() })
    this.tracker.on('complete', () => { this.stats.announces++; this.updateStats() })
    this.tracker.on('stop', () => { this.stats.announces++; this.updateStats() })
  }

  updateStats() {
    this.stats.torrents = Object.keys(this.tracker.torrents).length
    this.stats.peers = Object.values(this.tracker.torrents)
      .reduce((total, torrent) => total + torrent.peers.length, 0)
  }

  setupHTTPServer() {
    // Store original request handlers before modifying
    const originalListeners = this.tracker.http.listeners('request')

    this.tracker.http.removeAllListeners('request')
    this.tracker.http.on('request', (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`)
      const pathname = url.pathname

      if (pathname === '/share') {
        this.serveStaticFile(req, res, 'torrent.html', 'text/html')
      } else if (pathname === '/api/stats') {
        this.serveStats(req, res)
      } else {
        // Delegate to original tracker handlers
        let handled = false
        for (const listener of originalListeners) {
          try {
            listener.call(this.tracker.http, req, res)
            handled = true
            break
          } catch (err) {
            console.warn('Handler error:', err.message)
          }
        }

        if (!handled) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('Not Found')
        }
      }
    })
  }

  serveStaticFile(req, res, filename, contentType) {
    const filePath = join(__dirname, filename)

    if (!existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end(`File not found: ${filename}\nPlace ${filename} next to tracker.js`)
      return
    }

    try {
      const content = readFileSync(filePath, 'utf8')
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(content)
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end(`Error serving file: ${error.message}`)
    }
  }

  serveStats(req, res) {
    this.updateStats()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(this.stats))
  }

  async start() {
    return new Promise((resolve, reject) => {
      // Handle potential binding errors
      this.tracker.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`❌ Port ${this.config.port} is already in use`)
          console.log('💡 Try a different port: node tracker.js --port 8081')
          process.exit(1)
        } else if (err.code === 'EINVAL') {
          console.error('❌ Invalid address/port combination')
          console.log('💡 Try: node tracker.js --host localhost --port 8080')
          process.exit(1)
        } else if (err.code === 'EACCES') {
          console.error(`❌ Permission denied for port ${this.config.port}`)
          console.log('💡 Try a port above 1024: node tracker.js --port 8080')
          process.exit(1)
        } else {
          console.error(`❌ Server error: ${err.message}`)
          reject(err)
        }
      })

      this.tracker.listen(this.config.port, this.config.hostname, (err) => {
        if (err) {
          console.error(`❌ Failed to start server: ${err.message}`)
          if (err.code === 'EADDRINUSE') {
            console.log('💡 Port is busy. Try: node tracker.js --port 8081')
          }
          reject(err)
        } else {
          resolve(this.tracker)
        }
      })
    })

    // Graceful shutdown
    process.on('SIGINT', () => this.shutdown())
    process.on('SIGTERM', () => this.shutdown())
  }

  async shutdown() {
    console.log('\n🛑 Shutting down server...')
    try {
      if (this.tracker?.http) this.tracker.http.close()
      if (this.tracker?.udp) this.tracker.udp.close()
      if (this.tracker?.ws) this.tracker.ws.close()
      console.log('✅ Server shutdown complete')
      process.exit(0)
    } catch (error) {
      console.error('❌ Shutdown error:', error)
      process.exit(1)
    }
  }
}

// CLI support
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = {}
  const args = process.argv.slice(2)

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port':
      case '-p':
        config.port = parseInt(args[++i])
        break
      case '--host':
        config.hostname = args[++i]
        break
      case '--help':
      case '-h':
        console.log(`
Generic WebTorrent P2P Server

Usage: node tracker.js [options]

Files needed:
  tracker.js  - This server file
  index.html  - Web interface (place in same directory)

Options:
  -p, --port <number>   Server port (default: 8080)
  --host <string>       Server hostname (default: localhost)
  -h, --help           Show this help

Examples:
  node tracker.js                    # Start on localhost:8080
  node tracker.js --port 8081        # Use different port
  node tracker.js --host 0.0.0.0     # Bind to all interfaces

Web Interface: http://localhost:8080/share
        `)
        process.exit(0)
    }
  }

  const server = new GenericWebTorrentServer(config)
  server.start().catch(console.error)
}

export default GenericWebTorrentServer