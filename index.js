/*
README: Render-deployable Express + Baileys server
Files included (paste them into your project):
  - server.js                (this file)
  - package.json             (see below)
  - public/index.html        (simple UI to show QR & status)

How it works
  - Starts an Express server and serves /public
  - Runs Baileys WhatsApp connection in the same process
  - Exposes endpoints:
      GET /status    -> JSON { connection: 'open'|'close'|..., lastError }
      GET /qr.svg    -> returns a QR SVG (if available)
      GET /auth      -> returns whether auth file exists

Notes
  - Install dependencies: npm i
  - Render: set the start command to `node server.js` and the port is read from process.env.PORT
  - For production consider moving the WhatsApp bot to a background worker to avoid web request timeouts
*/

// ---------- server.js ----------
const fs = require('fs')
const path = require('path')
const express = require('express')
const qrcode = require('qrcode')
const { default: makeWASocket, useSingleFileAuthState, fetchLatestBaileysVersion } = require('@adiwajshing/baileys')

const { state, saveState } = useSingleFileAuthState('./auth_info.json')

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

let connectionStatus = 'init'
let lastError = null
let lastQr = null

app.get('/status', (req, res) => {
  res.json({ connection: connectionStatus, lastError, authed: fs.existsSync('./auth_info.json'), hasQr: !!lastQr })
})

// return QR as an SVG image (data URL would also work)
app.get('/qr.svg', async (req, res) => {
  if (!lastQr) return res.status(404).send('No QR available')
  try {
    const svg = await qrcode.toString(lastQr, { type: 'svg', errorCorrectionLevel: 'M' })
    res.setHeader('Content-Type', 'image/svg+xml')
    res.send(svg)
  } catch (e) {
    res.status(500).send('QR render error')
  }
})

// optional: trigger scheduled messages endpoint (safe-guarded)
app.post('/trigger', async (req, res) => {
  // receive { messageIndex } etc. - implement your own guard/auth
  res.json({ ok: true })
})

// ---------- Baileys integration ----------
async function startBot() {
  const fallback = { version: [2, 212, 6] }
  const { version } = await fetchLatestBaileysVersion().catch(() => fallback)
  const sock = makeWASocket({ version, auth: state })

  sock.ev.on('creds.update', saveState)

  sock.ev.on('connection.update', update => {
    const { connection, qr } = update
    if (qr) {
      // store QR (string) so the web UI can display it
      lastQr = qr
      connectionStatus = 'qr'
      console.log('📲 QR available — open /qr.svg to scan')
    }

    if (connection === 'open') {
      connectionStatus = 'open'
      lastQr = null
      console.log('✅ Bot Connected!')
      // call scheduleMessages if you want
      try { scheduleMessages(sock) } catch (e) { console.error(e) }
    }

    if (connection === 'close') {
      connectionStatus = 'close'
      console.log('⚠️ Connection closed')
    }
  })

  sock.ev.on('creds.update', () => {
    // when auth file saved, clear QR
    if (fs.existsSync('./auth_info.json')) lastQr = null
  })

  sock.ev.on('connection.error', err => {
    lastError = err && (err.message || JSON.stringify(err))
  })

  return sock
}

// Reuse the scheduleMessages function you provided (slightly adapted)
function readLines(file) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'))
}

function scheduleMessages(sock) {
  const msgFile = path.join(process.cwd(), 'messages.txt')
  const timeFile = path.join(process.cwd(), 'time.txt')
  const targetsFile = path.join(process.cwd(), 'targets.txt')

  const messages = readLines(msgFile)
  const delays = readLines(timeFile).map(n => parseInt(n))
  const targetsRaw = readLines(targetsFile)

  if (messages.length === 0 || delays.length === 0) {
    console.log('⚠️ messages.txt ya time.txt empty hai!')
    return
  }
  if (messages.length !== delays.length) {
    console.log('⚠️ messages.txt aur time.txt ki lines equal honi chahiye!')
    return
  }
  if (targetsRaw.length === 0) {
    console.log('⚠️ targets.txt empty hai!')
    return
  }

  const targets = targetsRaw.map(t => {
    const clean = t.replace(/\D/g, '')
    if (t.includes('@')) return t
    return clean + '@s.whatsapp.net'
  })

  messages.forEach((message, i) => {
    const delaySec = delays[i]
    if (isNaN(delaySec)) return

    setTimeout(() => {
      targets.forEach(async (target) => {
        try {
          await sock.sendMessage(target, { text: message })
          console.log(`📩 Sent to ${target}: ${message}`)
        } catch (err) {
          console.error('❌ Error sending to', target, err.message || err)
        }
      })
    }, delaySec * 1000)

    console.log(`⏳ Scheduled: "${message}" after ${delaySec}s → ${targets.length} target(s)`)
  })
}

// start server + bot
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`)
  try {
    await startBot()
  } catch (e) {
    console.error('Start error', e)
    lastError = e && (e.message || JSON.stringify(e))
  }
})


// ---------- package.json (paste into a file named package.json) ----------
/*
{
  "name": "wa-render-server",
  "version": "1.0.0",
  "main": "server.js",
  "license": "MIT",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "qrcode": "^1.5.1",
    "@adiwajshing/baileys": "^4.0.0"
  }
}
*/

// ---------- public/index.html (create public/index.html) ----------
/*
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>WhatsApp Bot — Render</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; padding: 20px; }
    img { max-width: 320px; }
    .status { margin-top: 12px; }
  </style>
</head>
<body>
  <h1>WhatsApp Bot</h1>
  <div id="qr-area">
    <p>QR:</p>
    <div id="qr"><em>loading...</em></div>
  </div>
  <div class="status" id="status">Status: —</div>

  <script>
    async function refresh() {
      const r = await fetch('/status')
      const s = await r.json()
      document.getElementById('status').innerText = 'Status: ' + s.connection + (s.lastError ? (' — ' + s.lastError) : '')
      if (s.hasQr) {
        document.getElementById('qr').innerHTML = '<img src="/qr.svg" alt="qr" />'
      } else if (s.authed) {
        document.getElementById('qr').innerHTML = '<strong>Authenticated</strong>'
      } else {
        document.getElementById('qr').innerHTML = '<em>No QR</em>'
      }
    }
    setInterval(refresh, 3000)
    refresh()
  </script>
</body>
</html>
*/
