# Raspberry Pi Embedded Target — Plan (Pi Zero W v1.1 öncelikli)

Bu doküman, `gea-embedded` framework'ünün ESP32-S3 AMOLED hedefinin **Raspberry Pi embedded** muadiline taşınması için kapsamlı bir plandır. Amaç: aynı `app-render` ve `screen` app ailelerini, aynı `gea_embedded_app_*` sözleşmesini, aynı UI/raster C paydaşımlı kodunu ve aynı Vite/JS derleme hattını koruyarak Raspberry Pi üzerinde koşturmaktır.

**Birincil hedef cihaz: Raspberry Pi Zero W v1.1** (BCM2835, tek çekirdek ARMv6 @ 1 GHz, 512 MB LPDDR2) **+ Waveshare 7inch HDMI LCD (C) (1024×600 USB capacitive touch)**. Daha güçlü modeller (Pi 3/4/5, Zero 2 W, CM4) aynı binary'yi koşturacak şekilde planlanır, ancak tasarım kararları **en zayıf halka olan Zero W v1.1**'e göre verilir.

> Kapsam, `targets/esp32-s3-touch-amoled-2.06/` referans alınarak ve `docs/adding-a-target.md` kontrol listesine göre hazırlanmıştır. Plan, kod yazmadan önceki tasarım ve aşama kararlarını içerir.

**Onaylı kararlar (2026-06-22):**
1. Viewport: **Hibrit** (1024×600 native + 410×502 compat canvas / letterbox)
2. Multi-touch: **Tek parmak v1** (MT-B → tek akış)
3. Framebuffer: **RGB565 primary**, ARGB→RGB565 swizzle LUT
4. HDMI mode: **DMT grup 2, mode 16** (1024×768 reduced blank 60Hz, Pi Zero uyumlu) veya `hdmi_cvt=1024 600 60 6 0 0 0` + `mode 87`
5. Güç: **USB hub'lı tek 5V/2.5A kaynak**, hub OTG-capable, hub'dan Pi + LCD + HID

---

## 0. Hedef Özet ve Temel Kararlar

### 0.1 Hedef Tanımı
- **Hedef isim:** `rpi-display-1` (geçici çalışma ismi; SKU/board netleşince sabitlenir).
- **Konum:** `targets/rpi-display-1/`
- **Referans:** `targets/esp32-s3-touch-amoled-2.06/` + `docs/adding-a-target.md`

### 0.2 Pi Zero W v1.1 Donanım Profili (Birincil Hedef)

| Özellik | Değer | Tasarım Etkisi |
| ------- | ----- | -------------- |
| SoC | BCM2835 | VideoCore IV, KMS desteği **firmware sürümüne bağlı** |
| CPU | Tek çekirdek ARMv6 @ 1 GHz | NEON yok, atomics sınırlı; thread yerine state machine |
| RAM | 512 MB LPDDR2 | 32 MB heap tavanı, malloc dikkat |
| GPU | VC4 (sınırlı KMS) | GPU raster yok; tüm çizim CPU |
| Depolama | microSD | Yavaş I/O; asset'ler mümkünse RAM'de |
| Wi-Fi | BCM43438 (2.4 GHz b/g/n) | NetworkManager/wpa_supplicant |
| Bluetooth | BLE 4.1 | Temel HID, ses yok |
| USB | Tek USB OTG | Hub ile touch + HID aygıtlar |
| GPIO | 40-pin header | I2C, SPI ekranlar için yedek |
| **Ekran** | **Waveshare 7inch HDMI LCD (C) 1024×600 IPS** | HDMI görüntü + USB capacitive touch (5-10 nokta MT-B) |
| **HDMI** | Mini-HDMI, piksel saati ~50 MHz sınır | 1024×60Hz reduced blank uyumlu |
| **Touch** | USB-HID multi-touch (Goodix/ILI2130 varyant) | libinput standart HID-MT; evdev tek-akışa indirgenecek |

> **Zorunlu sadelik:** tek-çekirdek CPU, sınırlı RAM, GPU yok. Bu hedef, Pi 4/5 için yazılmış bir planın basitçe indirgenmesi değil, **baştan sıkı bir bütçeyle** yazılmalıdır.

### 0.3 Desteklenecek Pi Modelleri (Tiered)
| Tier | Modeller | Profil | Görüntü | Giriş |
| ---- | -------- | ------ | ------- | ----- |
| 0 (Birincil) | **Pi Zero W v1.1**, Pi Zero v1.3 | Linux userspace, X11 yok | `/dev/fb0` (varsayılan) veya KMS (firmware bağımlı) | USB HID touch / mouse |
| 1 | Pi Zero 2 W, Pi 3A+ | Aynı ikili | KMS atomik (varsa) veya linuxfb | USB HID touch |
| 2 | Pi 4, Pi 400, Pi 5, CM4 | Aynı ikili | KMS/DRM dumb buffer (en iyi yol) | USB HID + I2C touch |
| 3 | Custom carrier (CM4) | Aynı ikili | Aynı + DSI panel sürücüsü | I2C touch (FT6236/GT911) |

> v1 ikili dosyası **tüm tier'ları** koşturur; tek fark çalışma zamanında `GEA_RPI_DISPLAY_BACKEND=auto|linuxfb|kms` env ile seçilen yoldur. `auto`, firmware'in sunduğu en iyi yolu seçer.

### 0.4 Temel Mimari Kararlar
1. **OS / Runtime:** Raspberry Pi OS Lite (32-bit, ARMv6 uyumlu). 64-bit Pi OS yalnızca Pi 3+ için; Zero W v1.1 zorunlu olarak **32-bit** (armv6 hard-float). Sistem servisi olarak değil, isteğe bağlı `systemd` unit'i ile.
2. **App runtime ailesi:** `app-render` (öncelik) + `screen` (aynı sözleşme). `app-render` zaten **C tabanlı** olduğu için JS olmadan da çalıştırılabilir; bu Zero için **kritik** bir esneklik sağlar.
3. **JavaScript runtime:** V8 veya QuickJS. **Karar:** `vendor/` altında **QuickJS** (düşük footprint, deterministik başlatma, kolay AOT/bytecode, ARMv6 desteği var). Moddable/XS yerine, çünkü Pi'ye ESP32'nin kendine özel `xsPlatform.h` katmanını taşımak gereksiz; Pi tarafında zengin bir POSIX katmanı var.
4. **Build sistemi:** **CMake + Ninja** ana akış; `geat-rpi.sh` script'i ile sarmalanır. ESP-IDF kullanılmaz.
5. **Çapraz derleme:** İsteğe bağlı `arm-linux-gnueabihf` toolchain. **Yerel Pi'de derlemek birincil senaryodur** (Zero W v1.1 zayıf olduğu için geliştirici genelde daha güçlü bir makinede çapraz derler).
6. **Framebuffer formatı:** RGB565, packed, `stride == width * 2`. Sözleşme `docs/architecture.md` ile aynı.
7. **OTA / Update:** Network update (curl/APT). Pi zaten ağa bağlı; ESP32'deki A/B partition mantığına gerek yok. Bunun yerine **app-version pinning + asset diff**.
8. **Simulator:** Mevcut WASM simulator **bire bir aynı** framebuffer formatını kullandığı için Pi çıktısıyla bire bir karşılaştırılabilir kalır.
9. **Threading modeli:** Tek ana thread + olay tabanlı state machine. Zero'da thread preemptive context switch maliyeti yüksek; libdispatch benzeri bir model veya basit bir `select/poll` döngüsü yeterli.
10. **Bellek bütçesi:**
    - Sistem: ~80 MB (Pi OS Lite headless)
    - Framebuffer: 410×502×2 = **412 KB** (RGB565)
    - UI tree + store: ~1-4 MB
    - JS heap: 4-8 MB
    - Image cache: sınırla (max 4-6 eşzamanlı handle, ESP32 ile aynı)
    - Toplam çalışma seti: **< 100 MB** hedef

### 0.5 Yeniden Kullanım
- `targets/shared/**` (UI core, layout, render, text, input, raster, image, font, image/ble/imu c'leri) → **tamamen yeniden kullanılır**.
- `lib/vite-plugin-gea-embedded/**` → bire bir aynı.
- `examples/**` → bire bir aynı (her app için `targets.rpi.enabled` eklenir).
- `targets/esp32-s3-touch-amoled-2.06/main/CMakeLists.txt` içindeki **XS derleme hattı** yerine **QuickJS derleme hattı** kurulur.

---

## 1.5 Donanım Kurulumu (Waveshare 7inch HDMI LCD (C))

### 1.5.1 Bileşen Listesi
- Raspberry Pi Zero W v1.1 (BCM2835, 512 MB, mini-HDMI)
- Waveshare 7inch HDMI LCD (C), 1024×600 IPS, USB capacitive touch
- USB OTG-capable hub (powered tercih edilir)
- 5V / 2.5A mikro-USB güç kaynağı
- microSD kart (≥ 8 GB, A1 sınıfı)
- (opsiyonel) USB klavye/fare
- mini-HDMI ↔ HDMI kablo veya adaptör (Waveshare kutusunda gelir)

### 1.5.2 Bağlantı Şeması
```
[5V / 2.5A güç kaynağı]
        │
        ▼
   [USB Hub (OTG-capable, optional self-powered)]
        │
        ├──► Pi Zero W v1.1 (micro-USB OTG portuna)
        ├──► Waveshare 7" LCD USB touch
        ├──► USB klavye / fare
        └──► (opsiyonel) USB flash disk (OTA cache)

[Pi Zero mini-HDMI] ──adaptör──► [Waveshare 7" LCD HDMI]
[Waveshare 7" LCD 5V] (kendi micro-USB ile beslenir; opsiyonel)
```

> **Güç dağıtımı:** Hub'ı besleyen kaynak aynı zamanda LCD'nin 5V'sini de Pi'nin `5V` GPIO pin'inden vermek yerine ayrı bir micro-USB ile bağlanır (galvanik olarak temiz, EMI düşük). Hub'ın data pinleri Pi'ye, power pinleri kaynaktan alınır.

### 1.5.3 /boot/config.txt
```ini
# === Waveshare 7inch HDMI LCD (C) — 1024x600 ===
# Pi Zero HDMI piksel saati ~50 MHz; 60Hz reduced blank kullanılır.

# Grup 2 (DMT) — mod 16: 1024x768 60Hz reduced blank
# (LCD 1024x600 doğal; reduced blank Pi Zero'da stabil)
hdmi_group=2
hdmi_mode=16
hdmi_drive=1            # DVI (LCD'ye uygun, ses kapalı)
hdmi_force_hotplug=1    # Pi Zero'da hotplug detect sorunlu
disable_overscan=1

# Alternatif: özel 1024x600 @ 60Hz
# hdmi_cvt=1024 600 60 6 0 0 0
# hdmi_mode=87

# USB güç artışı (touch + hub için)
max_usb_current=1

# GPU bellek (Pi Zero RAM kısıtlı)
gpu_mem=64

# Hızlandırma için
dtparam=audio=off
```

### 1.5.4 Güç Bütçesi
| Bileşen | Tipik | Pik |
| ------- | ----- | --- |
| Pi Zero W v1.1 (idle) | 120 mA | 180 mA |
| Pi Zero W v1.1 (Wi-Fi burst) | +150 mA | +250 mA |
| HDMI 1024×60 | +80 mA | +100 mA |
| LCD backlight (250 nit) | 250 mA | 300 mA |
| USB touch + hub overhead | 50 mA | 100 mA |
| **Toplam** | **~650 mA** | **~930 mA** |
| **2.5 A kaynak ile marj** | **3.8×** | **2.7×** |

### 1.5.5 Doğrulama
- `tvservice -s` ile mod doğrulanır.
- `cat /sys/class/graphics/fb0/modes` ile çekirdek framebuffer modu kontrol edilir.
- `evtest /dev/input/eventN` ile touch cihazı ve multi-touch event'leri doğrulanır.

---

## 1. Dizin Yapısı (Planlanan)

```
targets/
  rpi-display-1/
    CMakeLists.txt                # Üst-seviye CMake (system+host)
    cmake/
      rpi.toolchain.cmake         # aarch64 cross-compile (opsiyonel)
      FindKMS.cmake               # libdrm keşfi
      FindQuickJS.cmake           # QuickJS keşfi
      FindLibInput.cmake          # libinput/input-event keşfi
    main/
      app_main.c                  # app-render giriş noktası
      app_main_screen.c           # screen runtime giriş noktası
      display.c / display.h       # DRM/KMS dumb buffer backend
      display_linuxfb.c           # yedek /dev/fbX backend
      input.c / input.h           # libinput → touch dispatch
      platform.c                  # QuickJS xsPlatform muadili (QuickJSPlatform.h)
      assets.c                    # gömülü asset yükleme (image, font, JS)
      wifi.c / wifi.h             # NetworkManager / wpa_supplicant sorgu
      imu.c / imu.h               # I2C IMU okuması (örn. MPU6050, LSM6DS3)
      ble.c / ble.h               # BlueZ HID (BT mouse/keyboard) — opsiyonel
      mirror.c / mirror.h         # Cihaz-mirror TCP server (WebSocket/TCP)
      ota.c / ota.h               # Network update (HTTP + imza doğrulama)
      include/
        gea_embedded_config.h     # Pin/displaysiz config
    scripts/
      geat-rpi.sh                 # build/run/flash/install/log komutları
      package-sysroot.sh          # sysroot + payload paketleme
    systemd/
      gea-embedded.service        # isteğe bağlı systemd unit
    README.md                     # Kurulum, çalıştırma, troubleshoot
    docs/
      bring-up.md                 # İlk çalıştırma adımları
      display-pipeline.md         # DRM/KMS detayları
      input-pipeline.md           # libinput detayları
      runtime-choice.md           # V8 vs QuickJS kararı
    tests/
      test_display_contract.c
      test_input_contract.c
      test_runtime_smoke.c

examples/apps.json                  # her app'e targets.rpi.enabled eklenir
docs/
  rpi-target.md                     # Kullanıcı dökümanı
  adding-a-target.md                # güncellenir (rpi örneği eklenir)
```

---

## 2. Display Backend Planı

### 2.1 Sözleşme (Değişmiyor)
Mevcut `display.h` API'si korunur. Tek fark: pinmux/board başlatması kalkar.

```c
// display.h özet API (korunur)
void gea_embedded_display_init(void);
void gea_embedded_display_clear(void);
void gea_embedded_display_flush(void);
void gea_embedded_display_set_flush_config(int chunk_rows, int queue_depth);
void gea_embedded_display_fill_rect(int x, int y, int w, int h, uint16_t color);
void gea_embedded_display_draw_text(const char *text, int x, int y, uint16_t color, float scale);
void gea_embedded_display_blit_image(const uint16_t *src, int src_w, int src_h, int dx, int dy);
// ... (rounded rect, arc, triangle, alpha, clip, brightness — tam liste için display.h)
```

### 2.2 Backend Seçim Stratejisi (Pi Zero W v1.1 Öncelikli)

Pi Zero W v1.1 (BCM2835) için KMS desteği **firmware'e bağlıdır**:
- Eski firmware (< 2022): sadece legacy framebuffer (`/dev/fb0`), KMS yok.
- Yeni firmware (>= 2022, vc4-kms-v3d overlay): KMS var, ancak bazı sürümlerde instabil.

Bu nedenle **varsayılan backend = linuxfb**, KMS opsiyonel:

```
GEA_RPI_DISPLAY_BACKEND=auto|linuxfb|kms
  auto:    KMS varsa KMS, yoksa linuxfb (firmware ve modüller kontrol edilir)
  linuxfb: her zaman /dev/fbX
  kms:     KMS zorla (yoksa hata)
```

### 2.3 Linux Framebuffer Backend (Birincil — Pi Zero W v1.1)

- **Bağımlılık yok** (libdrm/libgbm gerekmez; sadece `<linux/fb.h>` ve `mmap`).
- **Akış:**
  1. `open("/dev/fb0")` → `fb_var_screeninfo`/`fb_var_screeninfo` oku.
  2. `smem_len` ve `line_length` kontrolü; gerekirse `FBIOBLANK`/`FBIOPUT_VSCREENINFO` ile yapılandır.
  3. `mmap(NULL, smem_len, PROT_READ|PROT_WRITE, MAP_SHARED, fd, 0)`.
  4. **Piksel formatı anlaşılır** (`GEA_RPI_PIXFMT` veya otomatik):
     - `RGB565` → bire bir kullan.
     - `ARGB8888` / `RGBA8888` → internal RGB565 shadow buffer + flush sırasında swizzle.
     - `8-bit indexed` → palet üzerinden dönüşüm (fallback, yavaş).
  5. **Çizim:** `display.c` UI tarafından doldurulan `uint16_t *back_buffer` (shadow) üzerinde yazıp, `flush()`'da fb'ye aktarır.
  6. **Vsync:** `FBIOWAITFORVSYNC` ioctl (kernel 4.4+); yoksa timer tabanlı tahmin (~16.6 ms @ 60 Hz).

**Yapı:**
```c
typedef struct {
    int fb_fd;
    struct fb_var_screeninfo var;
    struct fb_fix_screeninfo fix;
    void *fb_map;             // mapped framebuffer (veya NULL: shadow)
    uint16_t *back_buffer;    // shadow RGB565 (her zaman tahsis edilir)
    int back_buffer_size;
    int width, height;
    int native_bpp;           // 16 veya 32
    int has_vsync_ioctl;
} gea_linuxfb_t;
```

**Performans notu (Pi Zero):**
- Shadow + memcpy flush: ARGB8888 paneller için saniyede ~25-30 fps (410×502×4 = ~824 KB memcpy). Yeterli.
- RGB565 native: ~50-60 fps mümkün (sadece dirty-rect blit; aşağıya bakın).

### 2.4 KMS/DRM Backend (Opsiyonel — Pi 3/4/5 veya yeni Zero firmware)

- **Kütüphaneler:** `libdrm` (libgbm'ye gerek yok, dumb buffer yeterli).
- **Akış:** Planlanan önceki haldeki gibi (DRM aç → mode → dumb buffer → page flip).
- Pi Zero W v1.1 üzerinde KMS çalışırsa **sayfa değişimi vblank'a senkron** olur; bu yüzden tearing yok. Mümkünse tercih edilir, ama **zorunlu değil**.

### 2.5 Dirty-Rect Optimizasyonu (Pi Zero için Kritik)

Tüm ekranı her karede çizmek Zero'da pahalı. **Partial flush** ekle:
- `display_mark_dirty(x, y, w, h)` — UI tarafından flush öncesi çağrılır.
- `flush()` yalnızca birleştirilmiş dirty rect'i fb'ye aktarır.
- Boş dirty ise flush atlanır (statik sahne).
- **Kazanım:** statik UI için sıfır CPU; küçük animasyonlarda ~10× hızlanma.

> Mevcut `display.c`'de bu yok; **Pi target'ı için eklemek gerekir** (display sözleşmesine `display_mark_dirty_rect` eklenir, ESP32 backend'i no-op).

### 2.6 Renk ve Format
- **Hedef:** RGB565 little-endian, packed. Mevcut simulator ile bire bir aynı.
- ARGB8888 panel kullanılıyorsa: internal RGB565 shadow buffer + flush sırasında swizzle (lookup table, ~64 KB). **ARMv6'da NEON yok**, bu yüzden C ile yazılan satır-içi dönüşüm 410×502'de ~3-5 ms sürer. Yeterli.
- Dönüşüm için **hazır tablo** (`uint16_t → uint32_t`, 64 KB) oluşturulur; `static const` ile `.rodata`'ya konur, RAM tasarrufu.

### 2.7 Parlaklık / DDC / CEC
- Parlaklık: `/sys/class/backlight/*/brightness` (DPI panel) veya `drmModeConnectorSetProperty` (KMS modunda) veya `ddcutil` (HDMI).
- CEC: Kapsam dışı (Pi HDMI-CEC var, ama v1'de şart değil).

### 2.8 Doğrulama
- **Test 1:** Düz renk fill_rect, scanout (her iki backend).
- **Test 2:** Daire, line, rounded rect (dirty-rect ile birlikte).
- **Test 3:** `tic-tac-toe` app-render — referans framebuffer'ı simülatör WASM çıktısıyla diff (tolerans: 0 piksel fark; RGB565 packed aynıysa bire bir eşleşir).
- **Test 4 (Pi Zero):** 24 saat sürekli çalışma + sıcaklık izleme (termal throttling yok ama SD kart yıpranması).

### 2.9 Hibrit Viewport Politikası (Waveshare 1024×600)

**Karar:** Yeni app'ler 1024×600 native; eski 410×502 app'ler compat canvas ile letterbox.

**Karar modeli (`display.h`):**
```c
typedef enum {
    GEA_RPI_VIEWPORT_NATIVE_1024x600,   // yeni app'ler
    GEA_RPI_VIEWPORT_COMPAT_410x502,    // eski app'ler, letterbox
} gea_rpi_viewport_t;

void gea_embedded_display_set_viewport(gea_rpi_viewport_t vp);
gea_rpi_viewport_t gea_embedded_display_get_viewport(void);
```

**Karar mantığı:**
- `examples/apps.json` her app için `targets.rpi.viewport = "compat" | "native"` alanı içerir.
- v1'de **tüm app'ler `compat`** olur (geriye uyumlu).
- v2'de yeni app'ler `native` ile işaretlenir; canvas boyutu 1024×600 olur.

**Compat modda render akışı:**
```
[App 410x502 render] → [compat shadow buffer 410x502]
   ↓
[Center blit: 410x502 → 1024x600 framebuffer]
   ↓
[Letterbox: kenarda siyah bölge]
   ↓
[fb push]
```

**Letterbox yerleşim:**
- Yatay pad: `(1024 - 410) / 2 = 307` piksel (sol + sağ)
- Dikey pad: `(600 - 502) / 2 = 49` piksel (üst + alt)
- Toplam dolu alan: %67 (1024×600 = 614K piksel, 410×502 = 206K piksel, 206/614 = %33; **hayır, %33, geri kalanı siyah**)

> **Performans:** compat modda iç render 410×502; blit 205K piksel, Pi Zero'da 5-6 ms. Toplam 30 fps yeterli.

**Native modda:**
- App doğrudan 1024×600 framebuffer'a yazar.
- Pi Zero'da full-screen render sınırda; dirty-rect zorunlu.

**Flush davranışı (`gea_embedded_display_flush`):**
- Compat mod: `compat_shadow → fb0 (1024×600, padded)`
- Native mod: `back_buffer (1024×600) → fb0 (1024×600, full/dirty-rect)`

### 2.10 Doğrulama — Hibrit
- Compat: `tic-tac-toe` (410×502) 1024×600 letterbox içinde merkezde, simulator ile **piksel piksel aynı**.
- Native: yeni app örneği (örn. `examples/wide-static-card`) 1024×600 native render.

---

## 3. Input Backend Planı

### 3.1 Sözleşme
Mevcut `touch.h` API'si korunur (esp_err_t dönüşleri POSIX error code'ları ile değiştirilir veya kaldırılır):
```c
int gea_embedded_touch_read(int *x, int *y);                  // anlık okuma
int gea_embedded_touch_read_cached(int *x, int *y);           // thread-tarafından tutulan son değer
void gea_embedded_touch_consume_latest_move(int *x, int *y);  // coalesced
```

> Zero'da **threading maliyetli** olduğu için, önbellek modeli ana thread'in `select/poll` döngüsünde doldurulur; ayrı bir thread yerine `eventfd` veya libdispatch benzeri yapı kullanılır (aşağıya bakın).

### 3.2 libinput Backend (Öncelikli)
- `libinput` + `udev` (klavye, fare, dokunmatik panel, tek parmak touch).
- Tek bir thread'de `libinput_dispatch` → `libinput_get_event` → touch event'leri.
- **Koordinat dönüşümü:** `libinput_event_touch_get_transformed_x/y` ile 0..1 normalize → ekran koordinatına ölçekle.
- **Debounce & coalesce:** ESP32 sürümündeki mantık aynen (60 ms hareket, 30 ms up).
- **Multi-touch:** v1'de tek parmak yeterli. Çoklu parmak mimarisi (press_id) korunur.
- **libinput, Pi Zero'da çalışır**, fakat udev monitor thread'i tek çekirdeği meşgul edebilir. CPU yükünü izle.

### 3.3 /dev/input/eventX Doğrudan Backend (Pi Zero için Tercih Edilen)
- `libinput` olmadan doğrudan `/dev/input/event*` okunur.
- Daha az bağımlılık, daha düşük CPU. **Pi Zero için birincil yol.**
- udev ile cihaz adı/türüne göre filtrelenir (örn. `EVIOCGNAME` → "WaveShare", "Goodix", "FT6x06").
- `EVIOCGRAB` isteğe bağlı (kilitler; launcher'da sorun olabilir).

### 3.4 Tek-Çekirdek Olay Döngüsü
Zero'da thread preemptive context switch pahalı. **State machine + poll** kullanılır:
```c
// app_main.c
int xfd = open("/dev/input/event1", O_RDONLY | O_NONBLOCK);
int fbfd = open("/dev/fb0", O_RDWR);
int tfd = timerfd_create(CLOCK_MONOTONIC, ...);  // vsync

while (running) {
    struct pollfd pfds[3] = {
        { .fd = xfd, .events = POLLIN },
        { .fd = tfd, .events = POLLIN },
        { .fd = ctrlfd, .events = POLLIN },   // SIGINT, vs.
    };
    if (poll(pfds, 3, 16) > 0) {   // 16 ms = ~60 Hz
        if (pfds[0].revents & POLLIN) drain_touch(xfd);
        if (pfds[1].revents & POLLIN) drain_vsync(tfd);
        gea_embedded_app_frame(now_ms());
    }
}
```

> Bu model aynı zamanda **termal kontrol** için de iyidir: CPU %100 yükten kaçınır, 30 Hz'e otomatik düşer (poll timeout ayarı ile).

### 3.5 Klavye Kısayolları
- ESC / q → uygulamadan çıkış (headless geliştirmede).
- F1 → launcher'a dön (uygulamada destek varsa).
- Backspace → input alanında sil.

### 3.6 I2C Touch Controller (Tier 3)
- FT6236, GT911, ILI2511 gibi kontrolörler `/dev/i2c-1` üzerinden okunur.
- **Pi Zero W v1.1 üzerinde I2C için tekrar deneme (retry) şart**: yetersiz pull-up ve uzun kablolar nedeniyle okumalar bazen eksik olur.
- `imu.c` ile aynı `/dev/i2c-1` bus'ı paylaşır. Kilit: `pthread_mutex_t` (veya tek-çekirdek için atomik flag + lock-free ring buffer).

### 3.7 Multi-Touch Filtresi (Waveshare USB Capacitive)

Waveshare 7inch LCD (C) USB touch cihazı **HID-MT** (multi-touch) olarak `libinput`'a bağlanır. `evdev` üzerinden okunduğunda **MT-B (Type B)** protokolü görünür: her parmak için `ABS_MT_SLOT` + `ABS_MT_TRACKING_ID` + `ABS_MT_POSITION_X/Y`. v1 kapsamında **sadece ilk parmak** işlenir:

```c
// targets/rpi-display-1/main/input.c (özet)
#define GEA_INPUT_MAX_SLOTS 10
static int active_slot = -1;
static int slot_x[GEA_INPUT_MAX_SLOTS];
static int slot_y[GEA_INPUT_MAX_SLOTS];
static int slot_id[GEA_INPUT_MAX_SLOTS];

static void on_mt_slot(int slot) { /* ABS_MT_SLOT */ }
static void on_mt_tracking_id(int id) {
    // id == -1 → parmak kalktı
    if (id == -1 && slot == active_slot) {
        emit_touch_end(slot_x[slot], slot_y[slot]);
        active_slot = -1;
    } else if (active_slot == -1 && id != -1) {
        active_slot = slot;
        emit_touch_start(slot_x[slot], slot_y[slot]);
    }
}
static void on_mt_position(int x, int y) { slot_x[slot] = x; slot_y[slot] = y; }
```

> **v2'de** çoklu parmak desteği eklenebilir: iki parmak pinch/zoom ve iki parmak rotate gibi gesture'lar `press_id` semantiği korunarak eklenir. Şimdilik v1'de mimari korunur, davranış tek-akış.

### 3.8 IMU (tilt) — Opsiyonel
- MPU6050 / LSM6DS3 gibi I2C sensörler için `imu.c` muadili.
- `i2c-dev` kullanılır (`/dev/i2c-1`).
- 100 Hz örnekleme, ring buffer, ana thread'e `gea_embedded_imu_get()` ile expose.
- **Pi Zero'da büyük kısıt**: I2C bus'ın USB/Ethernet ile paylaşılması (BCM2835'te tek USB hattı). Yoğun USB HID kullanımı sırasında IMU okumaları gecikebilir. `tilt-breakout` Zero'da düşük performans gösterebilir; **dokümantasyon** notu olarak belirt.

### 3.9 BLE HID (Opsiyonel, v1'de devre dışı)
- BlueZ D-Bus API'si ile BLE mouse/keyboard.
- v1'de **opsiyonel**; v2'ye bırakılır. Pi Zero W v1.1 BLE 4.1 yongası temel HID profillerini destekler, ancak D-Bus stack overhead'i Zero'da hissedilir.
- `gea_embedded_ble_*` çağrıları no-op stub.

---

## 4. JavaScript Runtime: QuickJS Kararı

### 4.1 Neden QuickJS (Pi Zero W v1.1 için zorunlu)
- **Footprint:** 1-2 MB statik lib. V8 ~100 MB + JIT memory → Zero'da imkansız.
- **AOT bytecode:** `qjsc` ile önceden derlenmiş bytecode C dizisi olarak gömülür → runtime parse maliyeti yok.
- **ARMv6 desteği:** QuickJS saf C99, NEON/atomics gerektirmez. Pi Zero W v1.1 (ARMv6) ile uyumlu.
- **Deterministik başlatma:** 50-200 ms cold start (app + runtime). V8 ile 2-5 sn.
- **Moddable/XS yerine:** XS'in Pi'ye taşınması ayrı bir port projesi olurdu; QuickJS POSIX-native.

### 4.2 Bellek Bütçesi (QuickJS, Zero için)
- QuickJS heap: 4 MB (`JS_SetMemoryLimit` ile sınırla).
- Stack: 256 KB (JS fonksiyon başına).
- Bytecode: app başına ~50-200 KB (compressed `qjsc`).
- Opsiyonel: `--memory-limit=4M` ve `--stack-size=256`.

### 4.3 Dosya Yerleşimi
- `vendor/quickjs/` (submodule: `quickjs-ng/quickjs`, ARMv6 aktif).
- `targets/rpi-display-1/main/include/QuickJSPlatform.h` — `xsPlatform.h` muadili.

### 4.4 JS → Bytecode Akışı
```
examples/<app>/index.tsx
  -> vite build (gea-embedded plugin)
     -> dist/index.js  (thin JS)
     -> gea_embedded_app_generated.c
  -> host qjsc -e -o bytecode.c dist/index.js   (host x86_64'te derlenir)
  -> bytecode.c + shared C + app_generated.c + QuickJS linklenir
  -> ELF/PIE armhf binary (geat-app-<id>)
```

> **Not:** `qjsc` host makinede derlenir; Zero'ya sadece son binary kopyalanır. Cross-compile senaryosunda da aynı.

### 4.5 Vendor Katmanı
```c
// targets/rpi-display-1/main/include/QuickJSPlatform.h
// QuickJS'nin kendi platform.h template'i; biz sadece POSIX katmanını etkinleştiririz.
#define QUICKJS_PLATFORM_LINUX 1
// malloc davranışı: 4 MB tavan
// stack: 256 KB
// c_longjmp: setjmp/longjmp
```

### 4.6 Pure-C App Modu (Zero için Kritik)
Pi Zero'da `screen` runtime'ı çalıştırmak hâlâ pahalı olabilir. **Çoğu demo app (`tic-tac-toe`, `static-card`, `analog-clock`) aslında saf C'dir** — JS sadece ince glue. Bu app'ler `app-render` modunda çalışırken JS runtime'a **hiç ihtiyaç duymaz**:
- `gea_embedded_app_init/frame/touch` C'den çağrılır.
- QuickJS sadece `screen` runtime app'lerinde başlatılır.

**Tasarım kararı:** `gea-embedded` plugin, app'in `mount()` çağrısı olup olmadığına göre **JS runtime'ı koşullu olarak linkler**. Pure-C app'ler için `geat-app-<id>` sadece C ELF olur; ~300 KB binary, ~2-3 MB RSS.

### 4.7 Native API Shim
- Mevcut ESP32 tarafındaki host fonksiyonları (`screen.*`, `WiFi.*`, `Accelerometer.*`, `__gea_embedded_image.*`) QuickJS `JS_AddCFunction` ile aynı imzayla eklenir.
- Image decode: stb_image ve AnimatedGIF (mevcut) korunur. **Pi Zero'da image decode önemli bir maliyet**: 200×200 JPEG ~80-150 ms. Animasyonlu GIF'lerde 16 ms altı frame süresi zor; **frame skip stratejisi** gerekir (her 2. karede bir güncelle gibi).
- HTTP fetch: `libcurl` ile `WiFi`/`fetch()` API'si. HTTPS opsiyonel (`GEA_RPI_HTTPS=on|off`); Zero'da default **off** (RAM tasarrufu + mbedtls gereksinimi yok).

---

## 5. Build Sistemi

### 5.1 Üst-seviye CMake (Pi Zero W v1.1 için armhf)

```cmake
# targets/rpi-display-1/CMakeLists.txt (taslak)
cmake_minimum_required(VERSION 3.22)
project(gea_embedded_rpi C)

set(GEA_EMBEDDED_ROOT "${CMAKE_CURRENT_LIST_DIR}/../..")

# App seçimi (örnek: tic-tac-toe, app-launcher, ...)
set(GEA_EMBEDDED_APP "tic-tac-toe" CACHE STRING "App id")
set(GEA_EMBEDDED_RUNTIME "auto" CACHE STRING "auto|app-render|screen")
set(GEA_EMBEDDED_RESIDENT_APPS "none" CACHE STRING "Resident app id listesi")

# Seçenekler (Pi Zero için default'lar muhafazakâr)
option(GEA_RPI_HTTPS       "libcurl HTTPS desteği" OFF)         # Zero'da default OFF
option(GEA_RPI_BLE         "BlueZ HID desteği"     OFF)
option(GEA_RPI_IMU         "I2C IMU desteği"       OFF)
option(GEA_RPI_MIRROR      "Cihaz mirror server"   ON)
option(GEA_RPI_DIRTY_RECT  "Partial-flush optimizasyonu" ON)   # Zero için default ON
option(GEA_RPI_JS_RUNTIME  "JS runtime'ı linkle"   ON)         # pure-C app'lerde OFF yapılabilir

# Kütüphane keşfi
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_LIST_DIR}/cmake")
find_package(QuickJS REQUIRED)
# libdrm/libinput opsiyonel (linuxfb primary)

add_executable(geat-app-${GEA_EMBEDDED_APP}
    main/app_main.c
    main/display.c
    main/display_linuxfb.c
    main/display_kms.c      # sadece GEA_RPI_HAS_KMS=1 ise
    main/input.c
    main/assets.c
    main/platform.c
    main/wifi.c
    main/mirror.c
    main/ota.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/ui/core.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/ui/view.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/ui/text.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/ui/image.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/ui/layout.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/ui/render.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/ui/input.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/raster.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/image.c
    ${GEA_EMBEDDED_ROOT}/targets/shared/font_8x16.c
    ${GEA_EMBEDDED_ROOT}/vendor/AnimatedGIF/AnimatedGIF.c
    ${QJSC_OUTPUT}     # qjsc -o bytecode.c
    ${APP_GENERATED_C} # vite çıktısı
)

target_include_directories(geat-app-${GEA_EMBEDDED_APP} PRIVATE
    main/include
    ${GEA_EMBEDDED_ROOT}/targets/shared/include
    ${GEA_EMBEDDED_ROOT}/vendor/stb
    ${GEA_EMBEDDED_ROOT}/vendor/AnimatedGIF
    ${QUICKJS_INCLUDE_DIRS}
)

# Zero için minimum bağımlılık (linuxfb primary)
target_link_libraries(geat-app-${GEA_EMBEDDED_APP} PRIVATE
    ${QUICKJS_LIBRARIES}
    m pthread dl
)
# KMS/libdrm koşullu: find_package(KMS) başarısızsa hiç linklenmez
if(KMS_FOUND)
    target_link_libraries(geat-app-${GEA_EMBEDDED_APP} PRIVATE ${KMS_LIBRARIES})
endif()
if(GEA_RPI_HTTPS)
    target_link_libraries(geat-app-${GEA_EMBEDDED_APP} PRIVATE CURL::libcurl)
endif()
```

### 5.2 Vite + Build Orkestrasyonu
- ESP32 tarafındaki `add_custom_command` mantığı korunur: app kaynakları değiştiğinde `npm run build`, sonra `qjsc`.
- Vite plugin'in `cOutput` davranışı zaten generic; ekstra bir şey gerekmez.

### 5.3 Cross-Compile (arm-linux-gnueabihf)
- **Pi Zero W v1.1 hedefi: 32-bit ARM hard-float (`arm-linux-gnueabihf`).**
- `cmake/rpi.toolchain.cmake`: `CMAKE_SYSTEM_NAME=Linux`, `CMAKE_SYSTEM_PROCESSOR=arm`, sysroot yolu parametrik.
- Sysroot hazırlama (iki seçenek):
  - **Yerel:** Pi'de derleme, `scp` ile binary taşıma (basit).
  - **Çapraz:** Docker imajı `balenalib/raspberry-pi-debian:bookworm-run` ile sysroot oluşturma (önerilen).
- **Build host mimarisi:** Linux x86_64 veya aarch64; macOS'ta çapraz derleme sorunlu (QuickJS test edilmiş linux üzerinde).
- **Performans:** Pi'de `make` 4-6 dakika (tüm shared + app + QuickJS). Çapraz derleme 30-60 sn.

### 5.4 Paketleme
- `scripts/package-sysroot.sh`: binary + font atlas + app assets + config dosyaları → `geat-<id>-<version>.tar.gz`.
- `/opt/gea-embedded/apps/<id>/` altında kurulum için talimatlar.
- **SD karta yükleme:** `rsync -avz geat-app-tic-tac-toe pi@zero.local:/opt/gea-embedded/apps/tic-tac-toe/`.

### 5.5 Pi Zero Build Bütçesi
| Aşama | Süre (Pi'de yerel) | Süre (x86_64 çapraz) |
| ----- | ------------------ | -------------------- |
| QuickJS derleme | ~45 sn | ~6 sn |
| Shared C derleme | ~30 sn | ~3 sn |
| App generated C | ~5 sn | <1 sn |
| Vite (npm install + build) | ~90 sn | ~90 sn |
| Link | ~10 sn | <1 sn |
| **Toplam** | **~3-4 dakika** | **~2 dakika** |

> Vite aşaması Pi'de yavaş; ilk kurulumda `node_modules` SD kartta olur, sonraki buildler **artımlı** olur (cache'lenir).

---

## 6. Konfigürasyon ve Çalışma Zamanı

### 6.1 Konfig Dosyaları
- `/etc/gea-embedded/config.toml` — başlangıç app, çözünürlük, vsync, rotation, dirty-rect, poll period.
- `/etc/gea-embedded/wifi.toml` — STA kimlik bilgileri (Pi OS ağ yöneticisini okumak da seçenek).
- **Zero için bellek tasarrufu:** config dosyaları tek bir `gea-embedded.ini` altında (TOML parser maliyeti yerine basit `key=value`).

### 6.2 Ortam Değişkenleri (Pi Zero Default'ları)
| Değişken | Default | Açıklama |
| -------- | ------- | -------- |
| `GEA_RPI_DISPLAY_BACKEND` | `auto` | `auto\|linuxfb\|kms` |
| `GEA_RPI_FB` | `/dev/fb0` | Framebuffer cihazı |
| `GEA_RPI_DRM_CARD` | `/dev/dri/card0` | DRM kart aygıtı (KMS modunda) |
| `GEA_RPI_RES` | `auto` | `WxH` veya `auto` |
| `GEA_RPI_PIXFMT` | `auto` | `rgb565\|argb8888\|auto` |
| `GEA_RPI_VSYNC` | `1` | linuxfb FBIOWAITFORVSYNC; KMS page flip |
| `GEA_RPI_POLL_MS` | `16` | Ana olay döngüsü periyodu (ms). Zero için **33** önerilir (30 Hz) |
| `GEA_RPI_DIRTY_RECT` | `1` | Dirty-rect optimizasyonu (Zero için default ON) |
| `GEA_RPI_INPUT` | `evdev` | `evdev\|libinput\|i2c:<bus>:<addr>` |
| `GEA_RPI_HTTPS` | `0` | libcurl HTTPS (Zero'da default OFF) |
| `GEA_RPI_MIRROR` | `1` | Mirror server |
| `GEA_RPI_MIRROR_PORT` | `8082` | Mirror TCP portu |
| `GEA_RPI_LOG_PORT` | `8081` | Log TCP stream (ESP32 uyumlu) |
| `GEA_RPI_LOG_LEVEL` | `info` | `trace\|debug\|info\|warn\|error` |
| `GEA_RPI_MEM_LIMIT_MB` | `32` | RSS soft limit (mallinfo ile kontrol) |

### 6.3 systemd Unit (Pi Zero için optimize)
```ini
[Unit]
Description=Gea Embedded UI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/opt/gea-embedded/bin/geat-app-launcher
Restart=on-failure
RestartSec=2
Environment=GEA_RPI_POLL_MS=33
Environment=GEA_RPI_DIRTY_RECT=1
Environment=GEA_RPI_LOG_LEVEL=info
# Zero'da swappiness düşük tutulur (SD kart ömrü)
# Memory limit (kernel OOM tetiklemesin)
MemoryMax=96M
MemoryHigh=80M
# I/O scheduler
IOSchedulingClass=idle

[Install]
WantedBy=multi-user.target
```

> `MemoryMax=96M`, Zero'nun 512 MB RAM'inde %19'luk bir tavan; sistem + diğer servisler için yer bırakır.

### 6.4 Log
- `stderr` (systemd journal) + isteğe bağlı dosya: `/var/log/gea-embedded/app.log`.
- ESP32'deki TCP log stream'in Pi karşılığı: `nc -lk 8081` ile. Aynı sözleşme korunur → simulator uyumluluğu.

### 6.5 Pi Zero'ya Özel Çalışma Zamanı Notları

#### Termal Yönetim
- Pi Zero W v1.1 fansız; sürekli %100 yük altında **70-80°C** görür, performans düşmez (BCM2835 throttle'sız) ama SD kart yıpranır.
- `GEA_RPI_POLL_MS=33` (30 Hz) yeterli; 60 Hz zorunlu değil.
- Idle: ekran değişmediyse `flush()` no-op (dirty-rect boş).

#### SD Kart Ömrü
- `fsync` her log satırında değil, **her 5 saniyede bir** veya **dirty-rect değişiminde**.
- `tmpfs` üzerinde runtime cache: `/dev/shm/gea-embedded/`.
- `geat-rpi.sh install` swappiness'i 10'a çeker: `sysctl vm.swappiness=10`.

#### Güç Yönetimi
- USB otg portunu devre dışı bırak (güç tasarrufu): `dtoverlay=dwc2,dr_mode=host` kullanılmıyorsa kaldır.
- HDMI çıkışını kapat (sadece DPI panel kullanılıyorsa): `/usr/bin/tvservice -o`.

---

## 7. Ağ / OTA / Mirror

### 7.1 Mirror Server
- Aynı JSON mesaj şeması: snapshot + diff newline-delimited TCP, port 8082.
- Pi'nin avantajı: WebSocket + aynı anda HTTP SSE → tarayıcı native açabilir (Vite relay'e gerek yok). İlk sürümde **TCP** bırakılır, **WebSocket** v2'de.

### 7.2 OTA / Update
- HTTP(S) ile `geat-update` komutu: indirilen `.tar.gz` imza doğrulamalı (Ed25519 public key), `/opt/gea-embedded/apps/<id>/` üzerine açılır.
- Atomic rename: `apps/<id>/staging/` → `apps/<id>/current/`.
- Rollback: bir önceki sürüm `apps/<id>/previous/` olarak saklanır, başarısız açılışta otomatik geri dönüş.

### 7.3 Wi-Fi
- Pi OS ağ yöneticisinden `nmcli` ile okuma.
- `WiFi.isConnected()`, `getSSID()`, `getIP()`, `getRSSI()` → `nmcli -t -f ...` veya `/proc/net/wireless` parse.

---

## 8. Simulator Entegrasyonu

### 8.1 Framebuffer Karşılaştırması
- WASM simulator (zaten RGB565 packed üretiyor) ile Pi çıktısı **bire bir diff** edilebilir olur.
- `tests/diff-pi-vs-wasm/` altında headless capture → PNM → karşılaştırma.
- Testler: `tic-tac-toe`, `typography`, `static-card`, `analog-clock`, `tilt-breakout`.

### 8.2 Cihaz Mirror
- Pi, ESP32 ile aynı JSON şemasını konuştuğu için mevcut simulator **değişmeden** Pi'ye bağlanabilir.
- Tek ek: Vite relay opsiyonel — Pi doğrudan WebSocket açabilir.

---

## 9. examples/apps.json Güncellemesi

Her app girişine `targets.rpi` eklenir. v1 için:
```json
"targets": {
  "web":      { "enabled": true },
  "esp32":    { "enabled": true },
  "rpi": {
    "enabled": true,
    "viewport": "compat",     // "compat" | "native"
    "min_fps": 30
  }
}
```
- `bouncing-balls` (screen), `tic-tac-toe`, `static-card`, `typography`, `tilt-breakout`, `button-tetris`, `analog-clock`, `app-launcher` → v1 açık, **viewport: compat**.
- `watch-face` → v1'de web-only (mevcut durumla uyumlu).
- `image-demo`, `bouncing-balls-jsx`, `sky-hop*`, `settings`, `hid-clicker` → v1'de test edilir, açılır; **viewport: compat**.
- v2'de yeni app'ler `viewport: native` ile işaretlenir (örn. `examples/wide-static-card`).

**v1 dağılımı:** Tüm app'ler `compat` (geriye uyumlu). Pi Zero'ya özel ilk native app v2 ile gelir.

---

## 10. Aşamalar ve Teslimler

### Faz 0 — Karar ve Tasarım (1-2 gün)
- [ ] Bu plan dosyasını gözden geçir, hedef ismini dondur.
- [ ] Pi modelleri ve tier seçimini netleştir.
- [ ] V8 vs QuickJS kararı: **QuickJS** (4.1).
- [ ] linuxfb vs KMS kararı: **linuxfb primary, KMS optional** (2.2).
- [ ] Donanım seçimi: Pi Zero W v1.1 (BCM2835) + 8 GB microSD + 1 A güç kaynağı.

### Faz 1 — İskelet (3-5 gün)
- [ ] `targets/rpi-display-1/` dizin yapısını oluştur.
- [ ] `CMakeLists.txt` (üst-seviye), `main/app_main.c`, boş `display.c`/`input.c` stub'ları.
- [ ] Cross-compile toolchain: `arm-linux-gnueabihf` (Docker imajı).
- [ ] Vendor: QuickJS submodule (armv6 build ayarları ile).
- [ ] İlk başarılı derleme: `tic-tac-toe` app-render → siyah ekran basar.
- [ ] README.md taslağı.

**Çıkış kriteri:** Pi Zero W v1.1 üzerinde `geat-app-tic-tac-toe` çalışıyor, ekran siyah (henüz UI yok), RSS < 30 MB.

### Faz 2 — LinuxFB Display (5-7 gün)
- [ ] `display_linuxfb.c` implementasyonu (`/dev/fb0`, mmap, FBIOWAITFORVSYNC).
- [ ] Tüm raster API: fill_rect, stroke_rect, fill_circle, draw_line, draw_arc, fill_triangle, draw_text (8x16 + generated font), set_pixel, fill_rounded_rect, stroke_rounded_rect.
- [ ] **Dirty-rect optimizasyonu** (Pi Zero için kritik).
- [ ] **ARGB8888 → RGB565 swizzle** LUT (Pi HDMI çoğunlukla ARGB).
- [ ] Test: `test_display_contract.c` — tüm çağrılar no-crash + ekranda görünür.

**Çıkış kriteri:** `tic-tac-toe` UI tam render ediliyor, simulator framebuffer'ı ile bire bir eşleşiyor (diff=0), Pi Zero'da 30 fps.

### Faz 3 — Input (3-4 gün)
- [ ] `input.c` evdev backend (Pi Zero için birincil).
- [ ] libinput backend (Pi 3/4/5 için opsiyonel).
- [ ] Tek-çekirdek `poll` olay döngüsü.
- [ ] Klavye kısayolları (ESC/q/F1).
- [ ] (Opsiyonel) I2C touch controller backend — Tier 3.
- [ ] (Opsiyonel) IMU (i2c-dev) — Zero'da **bilinen kısıtlamayla** dokümante edilir.

**Çıkış kriteri:** `tic-tac-toe`'da USB mouse ile hamle yapılabiliyor, dokunmatik panel ile dokunma çalışıyor.

### Faz 4 — JavaScript Runtime (4-6 gün)
- [ ] QuickJS entegrasyonu (`qjsc` host build script).
- [ ] Native API shim'leri: `screen.*`, `WiFi.*`, `Accelerometer.*`, `__gea_embedded_image.*`, `fetch()`.
- [ ] **Pure-C app modu** (JS runtime'ı koşullu linkleme).
- [ ] Screen runtime testleri (`bouncing-balls`).
- [ ] Image decode: stb + AnimatedGIF + **frame skip stratejisi**.

**Çıkış kriteri:** `bouncing-balls` ve `tic-tac-toe` aynı Pi Zero'da koşuyor; framebuffer bire bir aynı; pure-C app RSS < 10 MB.

### Faz 5 — Ağ ve Servisler (3-5 gün)
- [ ] Wi-Fi sorgu (`nmcli` veya `/proc/net/wireless`).
- [ ] Mirror server (TCP 8082, aynı JSON şeması).
- [ ] HTTP fetch (libcurl, **HTTPS Zero'da default off**).
- [ ] OTA update + Ed25519 imza.
- [ ] systemd unit (MemoryMax=96M).
- [ ] `scripts/geat-rpi.sh` (build/run/install/log/reboot).

**Çıkış kriteri:** Simulator "Device mirror" Pi Zero'ya bağlanıyor, store state stream'leniyor; OTA ile yeni sürüm kurulabiliyor.

### Faz 6 — Polish ve Doku (2-3 gün)
- [ ] `docs/rpi-target.md` yaz (Pi Zero özelinde).
- [ ] `docs/adding-a-target.md` güncelle (Pi'yi örnek olarak ekle).
- [ ] **Pi Zero bilinen sınırlamalar** belgesi (tilt performansı, BLE yok, termal).
- [ ] Kurulum scripti: `install-zero.sh` (Pi OS Lite imajına tek komutla kurulum).

### Faz 7 — Doğrulama ve CI (3-4 gün)
- [ ] Framebuffer diff: Pi Zero capture vs WASM simulator (5 app).
- [ ] **QEMU user-mode smoke test** (x86_64'te armhf binary, Pi Zero regresyonu için).
- [ ] 24 saatlik sürekli-çalışma testi (sızıntı, termal, SD kart).
- [ ] Manuel test listesi: Pi Zero W v1.1, Pi 3A+, Pi 4, Pi 5.

---

## 11. Riskler ve Azaltma (Pi Zero W v1.1 Bağlamında)

| Risk | Olasılık | Etki | Azaltma |
| ---- | -------- | ---- | ------- |
| KMS sürücü/firmware uyumsuzluğu (Zero) | Yüksek | Yüksek | **linuxfb primary**; KMS yalnızca firmware açıkça destekliyorsa. |
| 512 MB RAM yetersiz (image cache, JS heap) | Orta | Yüksek | Dirty-rect zorunlu; JS heap 4 MB; image cache ≤ 4 handle; MemoryMax=96M. |
| Tek-çekirdek preemptive thread switch | Dünya | Orta | Tek ana thread + `poll` state machine; libdispatch tarzı. |
| 30 fps altına düşen animasyon | Yüksek | Orta | Dirty-rect + ARGB→RGB565 LUT + frame skip; 60 Hz zorunlu değil. |
| SD kart yıpranması (sürekli log/fsync) | Orta | Orta | 5 sn'de bir fsync; log tmpfs'e; swappiness=10. |
| I2C bus USB ile çakışma (Zero) | Yüksek | Düşük | IMU/Touch I2C okumalarını USB burst zamanlarında duraklat. |
| QuickJS ARMv6 build/test coverage | Düşük | Orta | CI'da `qemu-arm` user-mode ile smoke testi; Pi'de manuel smoke. |
| Termal throttling yok, SD ısınması | Orta | Düşük | 30 Hz varsayılan; ısıya göre dinamik 15-30 Hz. |
| 1 A güç kaynağı yetersiz (Wi-Fi burst) | Düşük | Düşük | 2.5 A tavsiye; install-zero.sh güç kaynağı testini içersin. |
| HDMI CEC / özel feature kaybı | Kesin | Düşük | Bilinen sınırlama olarak dokümante; v2'de geri alınabilir. |

---

## 12. Açık Sorular / Karar Bekleyenler

1. **Birincil ekran:** HDMI monitör mü, DPI panel mi, DSI panel mi? (v1 varsayım: HDMI; DPI/DSI için ek yol.)
2. **Touch:** USB HID mid, I2C FT6236 mı, I2C GT911 mi? (v1: USB HID öncelik; I2C tier 3.)
3. **Dağıtım formatı:** düz binary mi, .deb paketi mi, Pi Imager imajı mı? (v1: düz binary + `install-zero.sh`; v2: .deb.)
4. **BLE HID gerekli mi?** (v1: **hayır**; Pi Zero W v1.1 BLE 4.1 yeterli, ancak v1 kapsamı dışı.)
5. **GPU hızlandırma:** OpenGL ES / Vulkan ile yumuşatma/easing gerekli mi? (v1: **hayır**; BCM2835 GPU'ları genel amaçlı GLSL için yetersiz.)
6. **Çoklu Pi Zero senaryosu:** kiosk ağı mı, tek cihaz mı? (v1: tek cihaz; multi-display altyapısı korunur.)
7. **Pi OS sürümü:** Bookworm (2023+) mı, Bullseye (2021+) mı? (v1: Bookworm 64-bit/32-bit dual; Zero için 32-bit zorunlu.)

---

## 13. Kabul Kriterleri (Definition of Done — Pi Zero W v1.1)

Aşağıdakilerin tamamı sağlandığında hedef tamamlanmış sayılır:

- [ ] `tic-tac-toe` Pi Zero W v1.1 üzerinde **≥ 30 fps** render ediyor, simulator framebuffer'ı ile **0 piksel fark**.
- [ ] `tic-tac-toe` binary RSS **< 30 MB** (pure-C app modunda **< 10 MB**).
- [ ] `static-card`, `typography`, `analog-clock` aynı Pi Zero'da doğru render.
- [ ] `bouncing-balls` (screen runtime) aynı Pi Zero'da 30 fps yakını, animasyonlu GIF'ler oynatılabiliyor.
- [ ] `app-launcher` ile birden çok resident app başlatılabiliyor (Pi 4/5'te; Zero'da launcher v2).
- [ ] Simulator "Device mirror" Pi Zero'ya bağlanıyor ve store state stream'leniyor (JSON şeması ESP32 ile aynı).
- [ ] USB mouse ile `tic-tac-toe` oynanabiliyor; ESC ile çıkış çalışıyor.
- [ ] `systemd` ile başlatılınca uygulama otomatik açılıyor; restart on-failure.
- [ ] OTA update başarıyla uygulanıyor ve rollback test ediliyor.
- [ ] 24 saatlik sürekli-çalışma testinde **sızıntı yok** (RSS < 50 MB stabil).
- [ ] `docs/rpi-target.md` kullanıcı tarafından uçtan uca takip edilerek Pi Zero'yu 30 dakikada çalıştırabiliyor.
- [ ] `targets/esp32-s3-touch-amoled-2.06/` ve web simulator regresyona uğramıyor.
- [ ] Aynı binary Pi 4/5 üzerinde (varsa) KMS ile vsync çalıştırıyor.

---

## 14. Referanslar

- `docs/adding-a-target.md` — Hedef ekleme kontrol listesi
- `docs/architecture.md` — `app-render` / `screen` mimarisi
- `docs/esp32-target.md` — ESP32 mimari detayları
- `docs/device-mirror-protocol.md` — JSON şeması (Pi ile paylaşılır)
- `docs/generated-code.md` — Üretilen C'nin sözleşmesi
- `targets/esp32-s3-touch-amoled-2.06/main/CMakeLists.txt` — Derleme hattı referansı
- `targets/shared/include/xsPlatform.h` → QuickJS muadili için kaynak
- `examples/apps.json` — App manifest
- **Raspberry Pi Zero W v1.1:**
  - https://www.raspberrypi.com/documentation/computers/raspberry-pi.html
  - BCM2835 ARMv6: https://www.raspberrypi.com/documentation/computers/processors.html
  - Pi OS Lite (Bookworm): https://www.raspberrypi.com/software/operating-systems/
- **Display:**
  - Linux framebuffer: `Documentation/fb/` (kernel)
  - KMS/DRM: https://gitlab.freedesktop.org/mesa/drm
  - libdrm: https://gitlab.freedesktop.org/mesa/drm/-/tree/main/libdrm
- **Input:**
  - libinput: https://wayland.freedesktop.org/libinput/
  - evdev: `Documentation/input/` (kernel)
- **JavaScript runtime:**
  - QuickJS: https://bellard.org/quickjs/
  - quickjs-ng: https://github.com/quickjs-ng/quickjs (ARMv6 aktif)
- **Cross-compile:**
  - balenalib/raspberry-pi: https://hub.docker.com/r/balenalib/raspberry-pi
  - crosstool-NG: https://crosstool-ng.github.io/
- **Toolchain notu:** Pi Zero W v1.1 (BCM2835) **32-bit ARMv6 hard-float**; toolchain `arm-linux-gnueabihf` (Debian/Ubuntu). Pi 3+/CM4 64-bit ise `aarch64-linux-gnu`; aynı kaynak aynı toolchain ile çapraz derlenir, tek fakat aynı binary Pi Zero'da koşar (aşağı uyumlu).
