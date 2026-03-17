// ╔══════════════════════════════════════════════════════════╗
// ║     WhatsApp Bot - Layanan Kecamatan Medan Johor         ║
// ║     Powered by Baileys + Node.js                         ║
// ╚══════════════════════════════════════════════════════════╝

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import { handleMessage } from './handler.js';
import {
  getPendingFeedbacks, markFeedbackDone,
  getPendingLivechatReplies, markLivechatReplyDone,
} from './store.js';
import logger from './logger.js';

const CONFIG = {
  AUTH_DIR: './auth_info_baileys',
  RECONNECT_DELAY: 5000,
  MAX_RECONNECT_ATTEMPTS: 10,
};

const pinoLogger = pino({ level: 'silent' });
const delay = (ms) => new Promise(r => setTimeout(r, ms));

let reconnectCount = 0;
let feedbackInterval = null;
let livechatReplyInterval = null;

function resetAuth() {
  try {
    if (fs.existsSync(CONFIG.AUTH_DIR)) {
      fs.rmSync(CONFIG.AUTH_DIR, { recursive: true, force: true });
      logger.warn('AUTH', 'Folder auth dihapus untuk scan ulang');
    }
  } catch (e) {
    logger.error('AUTH', 'Gagal hapus auth', e.message);
  }
}

function startFeedbackWorker(sock) {
  if (feedbackInterval) clearInterval(feedbackInterval);
  feedbackInterval = setInterval(async () => {
    let pending;
    try { pending = getPendingFeedbacks(); } catch { return; }
    for (const fb of pending) {
      try {
        const jid = fb.pelapor.includes('@') ? fb.pelapor : `${fb.pelapor}@s.whatsapp.net`;
        const noLaporan = String(fb.laporanId || '').padStart(4, '0');
        const text =
          `*Pembaruan Laporan #${noLaporan}*\n` +
          `Halo ${fb.namaPelapor || 'Bapak/Ibu'}, berikut tanggapan dari *Kecamatan Medan Johor*:\n\n` +
          `${fb.pesan}\n\n_Terima kasih telah menggunakan layanan Hallo Johor_`;
        if (fb.fotoPath && fs.existsSync(fb.fotoPath)) {
          await sock.sendMessage(jid, { image: fs.readFileSync(fb.fotoPath), caption: text, mimetype: 'image/jpeg' });
        } else {
          await sock.sendMessage(jid, { text });
        }
        markFeedbackDone(fb.id, 'done');
        logger.success('FEEDBACK', `Terkirim ke ${jid}`);
      } catch (e) {
        markFeedbackDone(fb.id, 'failed');
        logger.error('FEEDBACK', `Gagal ke ${fb.pelapor}`, e.message);
      }
      await delay(1500);
    }
  }, 5000);
}

function startLivechatReplyWorker(sock) {
  if (livechatReplyInterval) clearInterval(livechatReplyInterval);
  livechatReplyInterval = setInterval(async () => {
    let pending;
    try { pending = getPendingLivechatReplies(); } catch { return; }
    for (const r of pending) {
      try {
        const jid = r.jid.includes('@') ? r.jid : `${r.jid}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: r.text });
        markLivechatReplyDone(r.id, 'sent');
      } catch (e) {
        markLivechatReplyDone(r.id, 'failed');
        logger.error('LIVECHAT', `Gagal ke ${r.jid}`, e.message);
      }
      await delay(300);
    }
  }, 2000);

  setInterval(() => {
    try {
      const f = './data/livechat_close_queue.json';
      if (!fs.existsSync(f)) return;
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      const pending = (data.queue || []).filter(c => c.status === 'pending');
      if (!pending.length) return;
      pending.forEach(async (c) => {
        try {
          const jid = c.jid.includes('@') ? c.jid : `${c.jid}@s.whatsapp.net`;
          await sock.sendMessage(jid, { text: 'Sesi LiveChat Anda telah ditutup oleh admin.\n\nKetik *menu* untuk kembali ke menu utama.' });
          c.status = 'done';
          fs.writeFileSync(f, JSON.stringify(data, null, 2));
          const { clearSession } = await import('./store.js');
          clearSession(jid);
        } catch {}
      });
    } catch {}
  }, 3000);

  logger.info('LIVECHAT', 'LiveChat reply worker aktif');
}

// ─── Start Bot ───────────────────────────────────────────
async function startBot() {
  logger.banner();
  logger.info('BOOT', 'Inisialisasi sistem bot...');

  if (process.env.RESET_AUTH === 'true') {
    logger.warn('AUTH', 'RESET_AUTH=true — hapus auth lama');
    resetAuth();
  }

  const { state, saveCreds } = await useMultiFileAuthState(CONFIG.AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info('VERSION', `Baileys v${version.join('.')}`, isLatest ? '(latest)' : '(outdated)');

  const sock = makeWASocket({
    version,
    logger: pinoLogger,
    printQRInTerminal: false,   // kita print manual supaya lebih rapi
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pinoLogger),
    },
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: false,
    getMessage: async () => ({ conversation: 'hello' }),
  });

  // ─── Connection Events ────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // ── QR Code muncul ──
    if (qr) {
      logger.divider();
      logger.info('QR', 'Scan QR Code berikut dengan WhatsApp:');
      logger.info('QR', 'Buka WhatsApp > Perangkat Tertaut > Tautkan Perangkat');
      logger.divider();

      // Print QR kecil (small=true) ke terminal/log Railway
      qrcode.generate(qr, { small: true });

      logger.divider();
      logger.warn('QR', 'QR Code berlaku ~60 detik. Segera scan!');
      logger.divider();
    }

    if (connection === 'connecting') {
      logger.state('CONNECTING', 'Menghubungkan ke server WhatsApp...');
    }

    if (connection === 'open') {
      reconnectCount = 0;
      logger.success('CONNECTED', 'Bot terhubung!', `${sock.user?.name} (${sock.user?.id})`);
      logger.divider();
      logger.success('READY', 'Bot siap menerima pesan!');
      logger.divider();
      startFeedbackWorker(sock);
      startLivechatReplyWorker(sock);
    }

    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      logger.warn('CONNECTION', `Koneksi terputus`, `Kode: ${code}`);

      if (code === DisconnectReason.badSession) {
        logger.error('AUTH', 'Sesi rusak — reset & restart untuk scan ulang');
        resetAuth(); await delay(2000); startBot();
      } else if (code === DisconnectReason.loggedOut) {
        logger.error('AUTH', 'Logout — reset & restart untuk scan ulang QR');
        resetAuth(); await delay(2000); startBot();
      } else if (code === DisconnectReason.connectionReplaced) {
        logger.error('AUTH', 'Sesi digantikan perangkat lain. Bot berhenti.');
        process.exit(1);
      } else {
        await scheduleReconnect();
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.remoteJid === 'status@broadcast' || !msg.message) continue;
      try { await handleMessage(sock, msg); }
      catch (e) { logger.error('HANDLER', 'Error', e.message); }
    }
  });

  sock.ev.on('groups.update', (updates) => {
    updates.forEach(u => logger.info('GROUP', `Update: ${u.id}`));
  });

  sock.ev.on('group-participants.update', ({ id, participants, action }) => {
    logger.info('GROUP', `${id}: ${action}`, participants.join(', '));
  });

  async function scheduleReconnect() {
    if (reconnectCount >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
      logger.error('RECONNECT', 'Menyerah setelah terlalu banyak gagal.');
      process.exit(1);
    }
    reconnectCount++;
    const wait = CONFIG.RECONNECT_DELAY * reconnectCount;
    logger.info('RECONNECT', `Percobaan ${reconnectCount}`, `tunggu ${wait / 1000}s`);
    await delay(wait);
    startBot();
  }

  return sock;
}

// ─── Process handlers ─────────────────────────────────────
process.on('uncaughtException', e => { logger.error('SYSTEM', 'Uncaught', e.message); console.error(e); });
process.on('unhandledRejection', e => { logger.error('SYSTEM', 'Unhandled Rejection', e?.message || String(e)); });
process.on('SIGINT', () => { logger.warn('SYSTEM', 'SIGINT — bot berhenti'); process.exit(0); });
process.on('SIGTERM', () => { logger.warn('SYSTEM', 'SIGTERM — bot berhenti'); process.exit(0); });

startBot().catch(e => {
  logger.error('BOOT', 'Gagal start', e.message);
  console.error(e);
  process.exit(1);
});
