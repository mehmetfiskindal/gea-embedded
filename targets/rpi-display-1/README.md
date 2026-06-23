# gea-embedded — Raspberry Pi target (Pi Zero W v1.1 + Waveshare 7" LCD (C))

Bu target, gea-embedded framework'ünün Raspberry Pi üzerinde koşmasını sağlar. Birincil hedef cihaz **Raspberry Pi Zero W v1.1** (BCM2835, 512 MB) + **Waveshare 7inch HDMI LCD (C)** (1024×600 USB capacitive touch).

## Durum

**Phase 1 iskeleti tamamlandı ve yerel olarak derleniyor.** Dev box'ta 365 KB ELF binary başarıyla üretildi (`build/rpi/geat-app-tic-tac-toe`). Pi Zero üzerinde henüz test edilmedi.

## Hedefler (Tiered)

| Tier | Cihaz | Display | Not |
| ---- | ----- | ------- | --- |
| **0 (Birincil)** | Pi Zero W v1.1 | linuxfb | BCM2835 KMS firmware-bağımlı |
| 1 | Pi Zero 2 W, Pi 3A+ | linuxfb veya KMS | Yeni firmware KMS açar |
| 2 | Pi 4, Pi 5, CM4 | KMS/DRM | Aynı ikili, farklı backend |

## Dokümanlar

| Dosya | İçerik |
| ----- | ------ |
| **`docs/try-on-pi.md`** | **Gerçek cihazda test rehberi (SD kart → LCD → build → install → run → sorun giderme)** |
| [README.md](README.md) | Bu dosya — hızlı bakış |
| [../../docs/rpi-target-plan.md](../../docs/rpi-target-plan.md) | Tam plan ve tasarım kararları |
| [../../docs/adding-a-target.md](../../docs/adding-a-target.md) | Hedef ekleme kontrol listesi (Pi örneği dahil) |

## Hızlı başlangıç (tek satır)

```bash
# 1) Pi OS Lite SD karta yazıldıktan ve SSH/Wi-Fi ayarlandıktan sonra:
./targets/rpi-display-1/scripts/install-zero.sh pi@raspberrypi.local

# 2) Host'ta çapraz derleme
./targets/rpi-display-1/scripts/geat-rpi.sh cross ./rpi-sysroot

# 3) Pi'ye yükle
./targets/rpi-display-1/scripts/geat-rpi.sh install pi@raspberrypi.local

# 4) Çalıştır
./targets/rpi-display-1/scripts/geat-rpi.sh run pi@raspberrypi.local
```

Ayrıntılar: **`targets/rpi-display-1/docs/try-on-pi.md`**

## Dizin

```
targets/rpi-display-1/
├── CMakeLists.txt                # Üst-seviye derleme
├── cmake/                        # Toolchain + Find modülleri
├── main/                         # Hedefe özel C kodu
│   ├── app_main.c                # app-render giriş noktası
│   ├── app_main_screen.c         # screen runtime giriş noktası (QuickJS)
│   ├── display.c                 # Backend dispatcher + raster wrappers
│   ├── display_linuxfb.c         # /dev/fb0 backend (Pi Zero primary)
│   ├── display_kms.c             # KMS/DRM stub
│   ├── input.c                   # evdev + MT-B → tek parmak
│   ├── platform.c                # POSIX zaman, sleep, mmap
│   ├── log.c                     # TCP log stream (port 8081)
│   ├── wifi.c                    # nmcli sorgu
│   ├── imu.c, mirror.c, ota.c    # Stub'lar
│   ├── assets.c                  # App asset'lerini /opt altından yükle
│   ├── quickjs_shim.{c,h}        # JS runtime bindings
│   └── include/                  # Hedef başlıklar
├── scripts/
│   ├── geat-rpi.sh               # build/install/run/log/status
│   └── install-zero.sh           # Pi OS Lite imajına kurulum
├── systemd/
│   └── gea-embedded.service      # Opsiyonel unit (MemoryMax=96M)
└── docs/
    └── try-on-pi.md              # Cihazda uçtan uca test rehberi
```

## Ortam değişkenleri

| Değişken | Default | Açıklama |
| -------- | ------- | -------- |
| `GEA_RPI_DISPLAY_BACKEND` | `auto` | `auto\|linuxfb\|kms` |
| `GEA_RPI_VIEWPORT` | `compat` | `compat\|native` (1024×600 vs 410×502 letterbox) |
| `GEA_RPI_POLL_MS` | `33` | Frame periyodu (Pi Zero için 30 Hz) |
| `GEA_RPI_FB` | `/dev/fb0` | Framebuffer cihazı |
| `GEA_RPI_LOG_LEVEL` | `info` | `error\|warn\|info\|debug\|trace` |
| `GEA_RPI_LOG_PORT` | `8081` | TCP log stream portu (simulator uyumlu) |
| `GEA_RPI_MIRROR_PORT` | `8082` | Mirror server portu |
| `GEA_RPI_HTTPS` | `0` | libcurl HTTPS (Pi Zero'da default off) |

## Bilinen sınırlamalar (v1)

- **KMS backend stub** — `display_kms.c` her zaman -1 döner; `display.c` linuxfb'e düşer. Phase 2.
- **BLE HID devre dışı** — Pi Zero W v1.1 BLE 4.1 yongası yeterli, ancak v1 kapsamı dışı.
- **I2C IMU devre dışı** — `tilt-breakout` tilt girişi olmadan başlar (UI çalışır).
- **Mirror server stub** — `HELLO` JSON gönderir, store snapshot akışı Phase 5.
- **OTA stub** — `geat-rpi.sh install` ile manuel kurulum.
- **Image cache dahil değil** — Phase 4.
- **QuickJS submodule eklenmemiş** — sadece `app-render` runtime çalışır (`tic-tac-toe` vb.); `bouncing-balls` (screen) için Phase 4 gerekir.

## Doğrulama durumu

| Yapıldı | Yapılmadı |
| ------- | --------- |
| ✅ Configure (cmake) | ❌ Cross-compile (armhf toolchain Fedora'da yok) |
| ✅ Build (x86_64 dev box, linuxfb) | ❌ KMS backend implementasyonu |
| ✅ Build (Pi Zero native, --skip-vite flow) | ❌ QuickJS screen runtime (submodule yok) |
| ✅ İlk Pi çalıştırma: linuxfb, touch, mirror, log | ❌ Framebuffer diff (simulator ile) |
| ✅ Sözleşme kontrolü (display API, raster wrappers) | ❌ Image cache (Phase 4) |
| ✅ Mimari kontrolü (install) — x86/ARM mismatch'i engelliyor | ❌ Mirror stream (snapshot/diff) |
| ✅ Sembol doğrulaması (GIF_begin, app_init, vb.) | ❌ systemd ile kalıcı çalıştırma |
| ✅ Script syntax (geat-rpi.sh, install-zero.sh) | |
| ✅ Vite helper (15 config otomatik Pi path'leri) | |
| ✅ Gerçek cihazda (Pi Zero W v1.1 + Waveshare 7" LCD) çalışıyor | |

**2026-06-22 doğrulama:** Pi'de `geat-app-tic-tac-toe` çalıştırıldı. linuxfb `/dev/fb0` 1024×600 16-bpp açıldı, `WaveShare WS170120` USB capacitive touch algılandı, mirror server 8082'de dinliyor, frame loop 33 ms periyod (30 Hz) ile çalışıyor.
