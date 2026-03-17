# 🤝 Hallo Johor — Bot WhatsApp Kecamatan Medan Johor

Bot pelayanan digital berbasis WhatsApp untuk warga Kecamatan Medan Johor, Kota Medan.

## Fitur
- 📢 Pengaduan Masyarakat (7 kategori, termasuk Bangunan Liar)
- 💬 LiveChat Admin real-time
- 🌐 Dashboard Web Admin
- 📊 Export Excel laporan
- 🔀 Routing laporan per kategori ke grup WhatsApp berbeda

## Cara Menjalankan
```bash
npm install
node start.js
```

## Teknologi
- Node.js + Baileys (@whiskeysockets/baileys)
- Dashboard: HTTP server vanilla + SSE real-time
- Storage: JSON file-based
