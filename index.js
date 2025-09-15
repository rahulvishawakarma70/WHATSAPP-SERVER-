const fs = require('fs')
const path = require('path')
const { default: makeWASocket, useSingleFileAuthState, fetchLatestBaileysVersion } = require('@adiwajshing/baileys')
const { state, saveState } = useSingleFileAuthState('./auth_info.json')
const qrcode = require('qrcode-terminal')

// Helper: read lines
function readLines(file) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'))
}

async function start() {
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 212, 6] }))
  const sock = makeWASocket({ version, auth: state })

  sock.ev.on('creds.update', saveState)

  sock.ev.on('connection.update', (update) => {
    const { connection, qr } = update
    if (qr) {
      console.log('📲 Scan QR in WhatsApp > Linked Devices')
      qrcode.generate(qr, { small: true })
    }
    if (connection === 'open') {
      console.log('✅ Bot Connected!')
      scheduleMessages(sock)
    }
  })
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

start().catch(e => console.error('Start error', e))￼Enter
