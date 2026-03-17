// ═══════════════════════════════════════════
//   DATA STORE - JSON Persistence Manager
// ═══════════════════════════════════════════

import fs from 'fs';
import path from 'path';

const DATA_DIR = './data';

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const readJSON = (file) => {
  const filePath = path.join(DATA_DIR, file);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
};

const writeJSON = (file, data) => {
  const filePath = path.join(DATA_DIR, file);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
};

// ── Grup Laporan ─────────────────────────────
export const getLaporanGroups = () => {
  const data = readJSON('laporan_groups.json');
  return data.groups || [];
};

export const addLaporanGroup = (groupId, groupName) => {
  const data = readJSON('laporan_groups.json');
  if (!data.groups) data.groups = [];
  const exists = data.groups.find(g => g.id === groupId);
  if (!exists) {
    data.groups.push({ id: groupId, name: groupName, addedAt: new Date().toISOString() });
    writeJSON('laporan_groups.json', data);
    return true;
  }
  return false;
};

export const removeLaporanGroup = (groupId) => {
  const data = readJSON('laporan_groups.json');
  if (!data.groups) return false;
  const before = data.groups.length;
  data.groups = data.groups.filter(g => g.id !== groupId);
  writeJSON('laporan_groups.json', data);
  // Bersihkan mapping kategori untuk grup ini
  const mapData = readJSON('group_kategori_map.json');
  if (mapData.map) {
    delete mapData.map[groupId];
    writeJSON('group_kategori_map.json', mapData);
  }
  return data.groups.length < before;
};

// ── Group Kategori Routing ────────────────────────────
// Menyimpan mapping: groupId → array kategori yang di-handle grup ini
// Jika array kosong / tidak ada = terima SEMUA kategori (default)

export const getGroupKategoriMap = () => {
  const data = readJSON('group_kategori_map.json');
  return data.map || {};
};

export const setGroupKategori = (groupId, kategoriList) => {
  const data = readJSON('group_kategori_map.json');
  if (!data.map) data.map = {};
  data.map[groupId] = Array.isArray(kategoriList) ? kategoriList : [];
  writeJSON('group_kategori_map.json', data);
};

// Kembalikan grup yang harus menerima laporan kategori ini.
// Logika: grup dengan kategori kosong = terima semua.
//         grup dengan kategori terisi = hanya terima yang cocok.
// Jika TIDAK ADA grup yang cocok (semua punya filter & tidak ada yang match),
// fallback ke semua grup agar laporan tidak pernah hilang.
export const getGroupsByKategori = (kategoriLabel, allGroups) => {
  const map = getGroupKategoriMap();
  const matched = allGroups.filter(g => {
    const assigned = map[g.id];
    // Tidak ada assignment = terima semua
    if (!assigned || assigned.length === 0) return true;
    return assigned.includes(kategoriLabel);
  });
  return matched;
};

// ── User Sessions ─────────────────────────────
const sessions = {};

export const getSession = (jid) => sessions[jid] || null;

export const setSession = (jid, data) => {
  sessions[jid] = { ...data, updatedAt: Date.now() };
};

export const clearSession = (jid) => {
  delete sessions[jid];
};

// ── Laporan Counter ───────────────────────────
export const getNextLaporanId = () => {
  const data = readJSON('laporan_counter.json');
  const next = (data.counter || 0) + 1;
  writeJSON('laporan_counter.json', { counter: next });
  return next;
};

// ── Laporan Archive ───────────────────────────
export const saveLaporan = (laporan) => {
  const data = readJSON('laporan_archive.json');
  if (!data.laporan) data.laporan = [];
  data.laporan.push(laporan);
  writeJSON('laporan_archive.json', data);
};

export const deleteLaporan = (id) => {
  const data = readJSON('laporan_archive.json');
  if (!data.laporan) return false;
  const before = data.laporan.length;
  data.laporan = data.laporan.filter(l => String(l.id) !== String(id));
  writeJSON('laporan_archive.json', data);
  return data.laporan.length < before;
};

export const addLaporanGroupManual = (groupId, groupName) => {
  // Alias publik yang menerima nama grup dari dashboard (bukan dari dalam grup WA)
  return addLaporanGroup(groupId, groupName);
};

// ── Feedback Queue ────────────────────────────
// Status: 'pending' | 'done' | 'failed'
export const queueFeedback = (item) => {
  const data = readJSON('feedback_queue.json');
  if (!data.queue) data.queue = [];
  data.queue.push({
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    status: 'pending',
    createdAt: new Date().toISOString(),
    sentAt: null,
    ...item,
  });
  writeJSON('feedback_queue.json', data);
};

export const getPendingFeedbacks = () => {
  const data = readJSON('feedback_queue.json');
  return (data.queue || []).filter(f => f.status === 'pending');
};

export const markFeedbackDone = (id, status = 'done') => {
  const data = readJSON('feedback_queue.json');
  if (!data.queue) return;
  const item = data.queue.find(f => f.id === id);
  if (item) {
    item.status = status;
    item.sentAt = new Date().toISOString();
    writeJSON('feedback_queue.json', data);
  }
};

// ══════════════════════════════════════════════
//   LIVE CHAT
// ══════════════════════════════════════════════

export const getLivechatSessions = () => {
  const data = readJSON('livechat_sessions.json');
  return (data.sessions || []).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
};

export const getLivechatByJid = (jid) => {
  const data = readJSON('livechat_sessions.json');
  return (data.sessions || []).find(s => s.jid === jid && s.status === 'active') || null;
};

export const getLivechatById = (sessionId) => {
  const data = readJSON('livechat_sessions.json');
  return (data.sessions || []).find(s => s.id === sessionId) || null;
};

export const startLivechatSession = (jid, name) => {
  const data = readJSON('livechat_sessions.json');
  if (!data.sessions) data.sessions = [];
  // Tutup sesi aktif sebelumnya
  data.sessions = data.sessions.map(s =>
    s.jid === jid && s.status === 'active'
      ? { ...s, status: 'closed', closedAt: new Date().toISOString() }
      : s
  );
  const session = {
    id: `lc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    jid,
    name,
    status: 'active',
    startedAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
    messages: [],
    unread: 0,
  };
  data.sessions.push(session);
  writeJSON('livechat_sessions.json', data);
  return session;
};

export const addLivechatMessage = (jid, from, text, mediaPath = null) => {
  const data = readJSON('livechat_sessions.json');
  if (!data.sessions) return null;
  const session = data.sessions.find(s => s.jid === jid && s.status === 'active');
  if (!session) return null;
  const message = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    from,   // 'user' | 'admin'
    text,
    mediaPath: mediaPath || null,
    timestamp: new Date().toISOString(),
  };
  session.messages.push(message);
  session.lastMessageAt = message.timestamp;
  if (from === 'user') session.unread = (session.unread || 0) + 1;
  writeJSON('livechat_sessions.json', data);
  return { session, message };
};

export const closeLivechatSession = (jid) => {
  const data = readJSON('livechat_sessions.json');
  if (!data.sessions) return false;
  const session = data.sessions.find(s => s.jid === jid && s.status === 'active');
  if (!session) return false;
  session.status = 'closed';
  session.closedAt = new Date().toISOString();
  writeJSON('livechat_sessions.json', data);
  return true;
};

export const closeLivechatSessionById = (sessionId) => {
  const data = readJSON('livechat_sessions.json');
  if (!data.sessions) return false;
  const session = data.sessions.find(s => s.id === sessionId);
  if (!session) return false;
  session.status = 'closed';
  session.closedAt = new Date().toISOString();
  writeJSON('livechat_sessions.json', data);
  return true;
};

export const markLivechatRead = (sessionId) => {
  const data = readJSON('livechat_sessions.json');
  if (!data.sessions) return;
  const session = data.sessions.find(s => s.id === sessionId);
  if (session) {
    session.unread = 0;
    writeJSON('livechat_sessions.json', data);
  }
};

// ── LiveChat Reply Queue (bot worker) ─────────
export const queueLivechatReply = (item) => {
  const data = readJSON('livechat_replies.json');
  if (!data.queue) data.queue = [];
  data.queue.push({
    id: `lcr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    status: 'pending',
    createdAt: new Date().toISOString(),
    sentAt: null,
    ...item,
  });
  writeJSON('livechat_replies.json', data);
};

export const getPendingLivechatReplies = () => {
  const data = readJSON('livechat_replies.json');
  return (data.queue || []).filter(r => r.status === 'pending');
};

export const markLivechatReplyDone = (id, status = 'sent') => {
  const data = readJSON('livechat_replies.json');
  if (!data.queue) return;
  const item = data.queue.find(r => r.id === id);
  if (item) {
    item.status = status;
    item.sentAt = new Date().toISOString();
    writeJSON('livechat_replies.json', data);
  }
};
