# antirea

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · **Türkçe** · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md)

**REA gibi yapay zeka destekli tersine mühendislik araçlarından projenizi koruyan bir skill.**

`rea` ve benzeri araçlar, MCP üzerinden AI agent'leri projenin binary dosyalarını, JS paketlerini ve APK'larını analiz etmek için yönlendirir. Antirea, agent'lerin ilk okuduğu yerlere "dur" direktifleri yerleştirir.

## Nasıl çalışır

REA üç adımda saldırır:

```
1. Kullanıcı → REA skill'ini agent'e yükler
2. REA skill'i → agent'e MCP araç çağrıları yapmasını söyler (open_binary, analyze_javascript_application vb.)
3. Agent → proje dosyalarını/binary'lerini okur ve analiz eder
```

Antirea 2. adımda devreye girer. Uyumlu bir agent, herhangi bir işlem yapmadan önce projenin instruction dosyalarını okur. Antirea bu dosyalara REA'yı engelleyen direktifler yazar.

```
1. Kullanıcı → REA skill'ini agent'e yükler
2. REA skill'i → agent'e "open_binary çağır" der
3. Agent → önce AGENTS.md okur → "REA YASAK" direktifini görür → DURUR
```

## Savunma katmanları

| Katman | Araç | Ne yapar |
|--------|------|----------|
| **L1** Agent instruction barrier | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` | Uyumlu agent REA araçlarını çağırmayı reddeder |
| **L1** Makine okunabilir engel | `.re-deny` | REA destekli araçlar için makine okunabilir sinyal |
| **L2** Terminal shim | `node_modules/.bin/rea` | `npx rea-agents` ve `rea` CLI'yi yakalar, exit 1 |
| **L3** JS obfuskasyon | `javascript-obfuscator` | Tüm tanımlayıcılar `a`, `b`, `c`... olur — REA çıktısı anlamsız |
| **L3** Source map silme | `strip-sourcemaps.js` | `.map` dosyaları dağıtıma girmez |
| **L3** IPC kanal hashleme | `antirea-ipc-hash.js` | Electron kanal isimleri `ch_a3f9b2` gibi hash'lere dönüşür |
| **L3** ASAR şifreleme | electron-builder fuses | `analyze_javascript_application` ASAR'ı okuyamaz |
| **L3** Debug sembol silme | strip / CMake flags | `binary_overview` / `analyze_function` sadece `sub_XXXX` görür |
| **L3** Rust .dep-v0 silme | `antirea-strip-rust.sh` | `inspect_rust_binary` dependency tree'yi göremez |
| **L3** Go strip + trimpath | `-ldflags="-s -w" -trimpath` | `inspect_go_binary` modül bilgisi döndüremez |
| **L3** Android R8 + ProGuard | `proguard-antirea.pro` | JADX `class a { void a(b c) }` görür |
| **L3** .NET obfuskasyon | ConfuserEx | CIL metadata karıştırılır, string'ler şifrelenir |

## Çalışma sırası

```
npm install   →  postinstall: shim'ler node_modules/.bin'e kurulur
npm run build →  prebuild: embed-barrier.js çalışır, barrier artifact'a gömülür
               →  build: normal build devam eder
```

Agent instruction dosyaları (AGENTS.md) kaynak dizini korur. `embed-barrier.js` dağıtılan bundle/binary'yi korur. İkisi birlikte çalışır.

## Kurulum

### 1. AGENTS.md / CLAUDE.md

`templates/agents-inject.md` içeriğini mevcut agent instruction dosyanızın **en başına** kopyalayın. Dosya yoksa doğrudan `AGENTS.md` olarak kopyalayın.

### 2. .re-deny

`templates/re-deny` dosyasını proje köküne `.re-deny` olarak kopyalayın.

### 3. package.json (JavaScript projeleri için)

`package.json`'a ekleyin:

```json
{
  "rea": {
    "deny": true,
    "reason": "Analysis not authorized by project owner.",
    "contact": ""
  },
  "dependencies": {
    "rea-agents": "file:scripts/rea-agents-shim"
  }
}
```

### 4. Honeypot (opsiyonel)

**JavaScript:** `templates/honeypot-js.js` dosyasını `package.json`'daki `"main"` alanıyla eşleşen isimde (ör. `app.js`, `bundle.js`) projeye kopyalayın.

**Native:** `templates/honeypot-native.c` dosyasını derleyin ve sonucu REA'nın açacağı binary'yle aynı isimde konumlandırın:

```bash
# Linux
cc -shared -fPIC -o libcore.so templates/honeypot-native.c

# macOS
cc -dynamiclib -o libcore.dylib templates/honeypot-native.c
```

## Önemli sınırlar

| Senaryo | Antirea durdurabilir mi? |
|---------|--------------------------|
| REA skill'i yüklü agent (Claude Code, Cursor, Codex) | **Evet** — AGENTS.md barrier'ı |
| Proje dizininde `npx rea-agents` çalıştırılması | **Evet** — node_modules/.bin shim'i |
| Dağıtılmış bundle/binary analizi | **Kısmen** — uyumlu agent'ler embed-barrier.js ile durur |
| Proje dışından absolute path ile `rea` çalıştırılması | **Hayır** |
| Instruction dosyalarını yoksayan agent | **Hayır** |
| Binary obfuskasyon / gerçek koruma | **Kapsam dışı** |

## Gereksinimler

- **Node.js** 18 veya üzeri
- **npm** 8 veya üzeri
- Hardening araçları (javascript-obfuscator, ProGuard, ConfuserEx vb.) her proje için ayrıca kurulmalıdır — antirea bunları sizin için kurmaz

## Sorumluluk reddi

**Antirea hiçbir garanti verilmeksizin olduğu gibi sunulmaktadır.**

- Antirea, projenizin tersine mühendisliğinin imkânsız olduğunu garanti etmez. AI destekli analizin maliyetini ve karmaşıklığını önemli ölçüde artırır; ancak binary'nize fiziksel erişimi olan ve sınırsız zamanı bulunan deneyimli bir analist yine de tersine mühendislik yapabilir.
- Antirea'nın yazarları, bu aracın kullanımından veya kötüye kullanımından kaynaklanan herhangi bir zarar, kayıp veya hukuki sonuçtan sorumlu değildir.
- Dağıtımdan önce antirea'nın korumalarının projenize doğru şekilde uygulandığını doğrulamak sizin sorumluluğunuzdadır.
- Antirea hukuki tavsiye niteliği taşımaz. Fikri mülkiyetiniz için hukuki koruma gerekiyorsa yetkili bir avukata danışın.

**Antirea'yı kullanarak sonuçların tüm sorumluluğunu kabul etmiş olursunuz.**

## Katkıda bulunma

Bir koruma açığı mı buldunuz? Issue veya pull request açın.

## Lisans

MIT