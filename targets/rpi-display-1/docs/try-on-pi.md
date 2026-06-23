# Gerçek Cihazda Test Rehberi

Bu doküman, `gea-embedded` Raspberry Pi target'ını **Raspberry Pi Zero W v1.1 + Waveshare 7inch HDMI LCD (C)** üzerinde uçtan uca çalıştırmak için adım adım yol gösterir.

> Hedef kitle: geliştiricinin elinde bir Pi Zero W v1.1 ve Waveshare 7" LCD var; bir masaüstü/dizüstü geliştirme makinesi var (Linux/macOS/WSL). Aynı ağda bir Wi-Fi erişim noktası var.

---

## 0. İhtiyaç Listesi

### 0.1 Donanım
| # | Parça | Not |
| - | ----- | --- |
| 1 | Raspberry Pi Zero W v1.1 | BCM2835, 512 MB |
| 2 | microSD kart ≥ 8 GB, A1 sınıfı | Class 10 önerilir |
| 3 | Waveshare 7inch HDMI LCD (C) | 1024×600 USB capacitive touch |
| 4 | USB OTG-capable hub | Powered tercih edilir |
| 5 | 5V / 2.5A mikro-USB güç kaynağı | Hub'ı besler |
| 6 | mini-HDMI ↔ HDMI kablo | Waveshare kutusunda gelir |
| 7 | micro-USB kablo (data) | Pi ↔ hub bağlantısı |
| 8 | USB klavye/fare (test için) | Veya USB capacitive touch zaten yeterli |
| 9 | microSD kart okuyucu | Geliştirme makinesinde |

### 0.2 Yazılım (Geliştirme Makinesi)
- Linux, macOS veya WSL2 — test edilen yapı
- `cmake >= 3.22`, `pkg-config`, `arm-linux-gnueabihf-gcc` (çapraz derleme için)
- `node >= 20.19` veya `>= 22.12`, `npm`
- `ssh`, `scp`, `rsync`
- (opsiyonel) `docker` — sysroot çıkarmak için

---

## 1. microSD Kartı Hazırla

### 1.1 Raspberry Pi OS Lite'ı yaz
Raspberry Pi Imager'ı kullanın: https://www.raspberrypi.com/software/

1. **OS:** `Raspberry Pi OS Lite (64-bit)` seçin (Pi Zero W v1.1 için 64-bit desteği vardır ancak performans için 32-bit de tercih edilebilir — kurulum adımları aynı).
2. **Advanced options** (Ctrl+Shift+X):
   - `Enable SSH` → `Use password authentication`
   - `Set username and password` → örn. `pi / raspberry`
   - `Configure wireless LAN` → kendi Wi-Fi SSID/parolanız
   - `Set locale settings` → TZ: Europe/Istanbul, KB: tr
3. **Storage:** microSD kartı seçin ve **WRITE**'a basın.

### 1.2 Kart takılınca ilk boot
1. SD kartı Pi'ye takın.
2. **HDMI kablo** ile Waveshare LCD'yi Pi'ye bağlayın.
3. **USB** kablo ile LCD'nin touch çıkışını Pi'nin USB OTG portuna (veya hub'a) bağlayın.
4. **Güç** kablosunu hub'a takın, hub'ı Pi'ye bağlayın.
5. **İlk boot ~30 sn sürer.** Seri konsol veya HDMI'dan login prompt'unu görmelisiniz.

> **Pi Zero HDMI çıkışı Pi OS ilk açılışta aktif olmayabilir** — `tvservice -s` çıktısı boşsa, HDMI kablo çıkar-tak veya `config.txt`'i aşağıdaki gibi düzenle.

### 1.3 SSH ile bağlan
Geliştirme makinesinden:
```bash
ssh pi@raspberrypi.local
# veya IP'yi öğrendikten sonra:
ssh pi@192.168.1.42
```

> İlk girişte "host key" sorusuna `yes` deyin.

---

## 2. HDMI + LCD Yapılandırması

Waveshare 7inch HDMI LCD (C) Pi Zero'nun sınırlı HDMI piksel saatinde (50 MHz) çalışacak şekilde optimize edilmiş bir mode gerektirir. `install-zero.sh` bunu otomatik yapar; ama adımları manuel yapmak isterseniz:

### 2.1 config.txt
Pi'ye SSH ile girip:
```bash
sudo cp /boot/firmware/config.txt /boot/firmware/config.txt.bak
sudo nano /boot/firmware/config.txt
```

Aşağıdaki satırları `# Pi defaults` satırının altına ekleyin:
```ini
# gea-embedded — Waveshare 7inch HDMI LCD (C)
hdmi_group=2
hdmi_mode=16          # 1024x768 60Hz reduced blank (Pi Zero uyumlu)
hdmi_drive=1          # DVI (LCD'ye uygun)
hdmi_force_hotplug=1  # hotplug detect sorunlu
disable_overscan=1
max_usb_current=1
gpu_mem=64
dtparam=audio=off
```

> **Not:** 1024×600 doğal panel olsa da, mod 16 (1024×768) Pi Zero'da en stabil olandır; LCD ölçeklemeyi kendi içinde yapar. Alternatif olarak `hdmi_cvt=1024 600 60 6 0 0 0` + `hdmi_mode=87` özel mode olarak kullanılabilir.

### 2.2 Yeniden başlat
```bash
sudo reboot
```

### 2.3 Doğrula
```bash
ssh pi@raspberrypi.local
tvservice -s
cat /sys/class/graphics/fb0/modes
```

Beklenen çıktı:
```
state 0xa [HDMI CEA (16) RGB lim 16:9], 1024x768 @ 60.00Hz, progressive
U:1024x768p-60
```

Eğer "state 0x0" veya boşsa: HDMI kablo sıkı mı, `hdmi_force_hotplug=1` var mı, güç yeterli mi kontrol edin.

---

## 3. Gea-embedded Kurulumu

### 3.1 Hızlı yol: `install-zero.sh`

Geliştirme makinesinde, **bir kere** çalıştırın:
```bash
cd /path/to/gea-embedded
./targets/rpi-display-1/scripts/install-zero.sh pi@raspberrypi.local
```

Bu script:
- `apt install` ile derleme bağımlılıklarını kurar (`cmake`, `build-essential`, `libdrm-dev`, vb.)
- `/boot/firmware/config.txt`'ye HDMI modunu yazar
- `vm.swappiness=10` ayarlar
- `/opt/gea-embedded/{apps,bin}` dizinlerini oluşturur
- systemd unit'ini yükler

> Script ~2-3 dakika sürer. Sonunda `sudo reboot` isteyecektir.

### 3.2 Manuel yol (öğrenmek isteyenler için)

#### 3.2.1 Bağımlılıklar
```bash
sudo apt-get update -y
sudo apt-get install -y --no-install-recommends \
    build-essential cmake ninja-build pkg-config \
    libdrm-dev libinput-dev libudev-dev libevdev-dev \
    git ca-certificates
```

#### 3.2.2 SD kart ömrü tuning
```bash
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/90-gea.conf
```

#### 3.2.3 Kurulum dizini
```bash
sudo mkdir -p /opt/gea-embedded/{apps,bin,logs}
sudo chown -R pi:pi /opt/gea-embedded
```

## 4. Build

Üç yol vardır: **Hibrit Derleme (Pi Zero için Önerilen)**, **Çapraz derleme (Cross-compilation)** veya **Yerel derleme (Pi üzerinde)**. 

> [!WARNING]
> Ana makinedeki standart çapraz derleyiciler (`gcc-arm-linux-gnueabihf`) başlangıç kütüphanelerini (startup/glue kodları) varsayılan olarak ARMv7-A hedefli getirdiği için Pi Zero'da `Illegal instruction` (Sıra Dışı Komut) hatası alabilirsiniz. Bu nedenle Pi Zero için **Hibrit Derleme** yöntemi önerilir.

### 4.1 Hibrit Derleme (Pi Zero W v1.1 için En Sağlıklı Yol)
Bu yöntemde JS/Vite derlemesi güçlü olan ana makinede yapılır; C derlemesi ise Pi'nin kendi ARMv6 kütüphaneleriyle uyumlu olması için Pi Zero üzerinde yerel olarak çalıştırılır.

#### 4.1.1 Ana Makinede (Host) Vite Build & Sync
```bash
# 1. Vite build işlemini ana makinede çalıştırın
cd /path/to/gea-embedded
cd examples/tic-tac-toe
npm install
GEA_EMBEDDED_TARGET=rpi npm run build
cd ../..

# 2. Kaynak kodunu ve derlenmiş Vite çıktılarını Pi'ye senkronize edin
./targets/rpi-display-1/scripts/geat-rpi.sh sync pi@raspberrypi.local --with-apps
```

#### 4.1.2 Pi Zero Üzerinde Yerel C Derlemesi
Pi Zero terminaline geçin ve C derlemesini Vite adımını atlayarak (`--skip-vite`) çalıştırın:
```bash
ssh pi@raspberrypi.local
cd ~/gea-embedded
./targets/rpi-display-1/scripts/geat-rpi.sh build --app=tic-tac-toe --skip-vite
```

#### 4.1.3 Pi Üzerinde Kurulum
```bash
sudo mkdir -p /opt/gea-embedded/apps/tic-tac-toe
sudo cp build/rpi/geat-app-tic-tac-toe /opt/gea-embedded/apps/tic-tac-toe/geat-app
sudo chown -R pi:pi /opt/gea-embedded
```

---

### 4.2 Çapraz Derleme (Alternatif)
Eğer ARMv6 uyumlu özel bir cross-toolchain kullanıyorsanız bu yolu tercih edebilirsiniz.

#### 4.2.1 Sysroot çıkar
Docker ile hızlıca:
```bash
docker create --name rpi-sysroot balenalib/raspberry-pi-debian:bookworm-run
docker cp rpi-sysroot:/usr ./rpi-sysroot
docker rm rpi-sysroot
# disk usage: ~250 MB
```

#### 4.2.2 Toolchain kur (ana makine)
```bash
# Debian/Ubuntu:
sudo apt-get install -y gcc-arm-linux-gnueabihf g++-arm-linux-gnueabihf
```

#### 4.2.3 Derle
```bash
cd /path/to/gea-embedded
./targets/rpi-display-1/scripts/geat-rpi.sh cross ./rpi-sysroot
```

#### 4.2.4 Binary'yi kontrol et
```bash
file build/rpi/geat-app-tic-tac-toe
# Expected: ELF 32-bit LSB executable, ARM, EABI5, ...
ls -la build/rpi/geat-app-tic-tac-toe
```

### 4.3 Yerel Derleme (Tamamen Pi üzerinde - Desteklenmez)

> [!CAUTION]
> Pi Zero W v1.1 üzerinde `npm run build` veya `vite build` çalıştırmaya çalışmak, Node.js'in ARMv6 mimarisini desteklememesinden dolayı **Illegal instruction** hatasıyla çökecektir. Bu nedenle, JS/Vite derlemesini Pi Zero üzerinde doğrudan yapamazsınız. Derleme için her zaman **Hibrit Derleme (4.1)** yöntemini kullanmalı, Vite adımını ana makinede yapıp Pi üzerinde sadece C derlemesini çalıştırmalısınız.

---

---

## 5. Cihaza Yükleme ve Çalıştırma

### 5.1 Yükleme (rsync)
```bash
cd /path/to/gea-embedded
./targets/rpi-display-1/scripts/geat-rpi.sh install pi@raspberrypi.local
```

Bu binary'yi `/opt/gea-embedded/apps/tic-tac-toe/geat-app` altına kopyalar.

### 5.2 İnteraktif çalıştırma (önce bunu deneyin)
```bash
./targets/rpi-display-1/scripts/geat-rpi.sh run pi@raspberrypi.local
```

Bu bir SSH oturumu açar ve binary'yi çalıştırır. **Çıkmak için Ctrl+C veya SSH oturumunu kapatın.**

Çıktı:
```
2026-06-22T16:43:18.722 INFO  [tic-tac-toe] === tic-tac-toe starting on linuxfb-rpi ===
2026-06-22T16:43:18.722 INFO  [display] linuxfb: /dev/fb0 1024x600 16-bpp (line 2048, smem 1232896)
2026-06-22T16:43:18.722 INFO  [display] using linuxfb backend (viewport 410x502)
2026-06-22T16:43:18.722 INFO  [input] opened /dev/input/event0 (WaveShare Touch)
2026-06-22T16:43:18.722 INFO  [log] TCP stream on 127.0.0.1:8081
2026-06-22T16:43:18.722 INFO  [main] entering frame loop (period 33 ms)
```

LCD'de **siyah ekran** (henüz UI yok) veya **compat viewport (410×502) içinde X-O oyunu** görmelisiniz.

### 5.3 Log izleme (arka planda çalışırken)
Ayrı bir terminalde:
```bash
./targets/rpi-display-1/scripts/geat-rpi.sh log pi@raspberrypi.local
```

Bu `/tmp/geat-tic-tac-toe.log` dosyasını `tail -F` ile izler.

### 5.4 systemd ile kalıcı çalıştırma
```bash
# Pi'de (ssh ile):
sudo systemctl daemon-reload
sudo systemctl enable --now gea-embedded
sudo systemctl status gea-embedded
```

Logları görmek için:
```bash
journalctl -u gea-embedded -f
```

---

## 6. Sorun Giderme

### 6.1 LCD'de görüntü yok
**Belirti:** Siyah ekran veya "No signal" mesajı.

**Çözüm adımları:**
```bash
# 1. HDMI modunu kontrol et
tvservice -s
# Beklenen: 1024x768 veya 1024x600

# 2. Framebuffer var mı?
ls -la /dev/fb0

# 3. config.txt doğru mu?
grep -E "hdmi_(group|mode|drive|force)" /boot/firmware/config.txt

# 4. HDMI kabloyu çıkar-tak (Pi Zero bazen hotplug kaçırır)

# 5. Güç yeterli mi? 2.5A kaynak kullanın, hub powered olsun
```

### 6.2 Touch çalışmıyor
**Belirti:** Parmak dokunuşları tepki vermiyor.

**Çözüm:**
```bash
# Touch cihazı görünüyor mu?
ls -la /dev/input/
# WaveShare veya "Goodix" benzeri bir isim olmalı

evtest /dev/input/event0
# Parmakla dokunduğunuzda ABS_MT_POSITION_X/Y event'leri görmelisiniz
```

Hiçbir cihaz görünmüyorsa:
- USB hub'ı powered modda deneyin
- LCD'nin USB kablosunu başka bir porta takın
- `dmesg | grep -i usb` ile kernel mesajlarına bakın

### 6.3 "Permission denied" fb0'a erişirken
**Belirti:** Log'da `cannot open /dev/fb0: Permission denied`.

**Çözüm:** Pi kullanıcısı `video` grubunda olmalı:
```bash
sudo usermod -aG video pi
# Yeniden giriş yapın
```

### 6.4 Yavaş / takılma
**Belirti:** UI 10 fps altında, gecikmeli.

**Çözüm:**
- `GEA_RPI_POLL_MS` artırın (örn. 50 ms = 20 Hz)
- Dirty-rect optimizasyonunu kontrol edin (`GEA_RPI_DIRTY_RECT=1`)
- `journalctl` ile CPU sıcaklığına bakın: `/sys/class/thermal/thermal_zone0/temp`
- MicroSD kart A1 sınıfı mı? Yavaş SD = yavaş Vite build (build sırasında)
- Yeterli güç kaynağı var mı? (Wi-Fi + LCD burst'lerde düşük voltaj)

### 6.5 Build hatası: "qjsc not found"
**Belirti:** Screen runtime (`bouncing-balls` gibi) build edemiyor.

**Çözüm:** QuickJS submodule henüz eklenmemiş. `app-render` runtime'la başlayın:
```bash
./targets/rpi-display-1/scripts/geat-rpi.sh build --app=tic-tac-toe
```

QuickJS, Phase 4'te eklenir.

### 6.6 Mirror bağlantısı kopuyor
**Belirti:** Simulator'da "Device mirror" Pi'ye bağlanamıyor.

**Çözüm:**
- Pi'de mirror portu açık mı? `ss -tlnp | grep 8082`
- Geliştirme makinesinden erişim: `nc -zv raspberrypi.local 8082`
- Firewall: `sudo ufw allow 8082`

### 6.7 Çapraz derleme "GLIBC not found" hatası
**Belirti:** Pi'de binary çalışmıyor, `GLIBC_2.N not found`.

**Çözüm:** Sysroot ile Pi'nin gerçek GLIBC versiyonunu kullanın:
```bash
# Pi'de:
ldd --version
# Ana makinede aynı versiyonu hedefleyin, veya
# Daha güvenli: Pi'de doğrudan derleyin
```

---

## 7. Geliştirme Döngüsü

### 7.1 Sık iterasyon (ana makinede)
```bash
# 1. App'i değiştir
$EDITOR examples/tic-tac-toe/components/App.tsx

# 2. Yeniden derle + yükle
./targets/rpi-display-1/scripts/geat-rpi.sh cross ./rpi-sysroot --app=tic-tac-toe
./targets/rpi-display-1/scripts/geat-rpi.sh install pi@raspberrypi.local --app=tic-tac-toe

# 3. Yeniden başlat (ssh üzerinden)
ssh pi@raspberrypi.local 'sudo systemctl restart gea-embedded'

# 4. Log izle
./targets/rpi-display-1/scripts/geat-rpi.sh log pi@raspberrypi.local
```

Tipik süre: **2-3 dakika** (build + install + restart + log).

### 7.2 Paylaşımlı geliştirme
Pi'de `geat-rpi.sh build` çalıştırın, ana makinede `geat-rpi.sh install` çalıştırın:
```bash
# Pi'de
cd /path/to/gea-embedded
./targets/rpi-display-1/scripts/geat-rpi.sh build
# ~3-5 dakika

# Ana makinede
./targets/rpi-display-1/scripts/geat-rpi.sh install pi@raspberrypi.local
```

### 7.3 Cihaz-mirror ile simülatör testi
Geliştirme makinesinde simulator çalışıyorsa:
1. Pi'de mirror portu dinliyor: `nc -l 8082` ile test edin
2. Simulator'da "Device mirror" seçin, host: `raspberrypi.local`, port: `8082`
3. Pi'deki store state değişiklikleri simülatöre yansır
4. Simülatör kendi WASM kopyasını render eder

---

## 8. Diğer Uygulamaları Denemek

Mevcut örneklerden herhangi birini derleyebilirsiniz:
```bash
./targets/rpi-display-1/scripts/geat-rpi.sh cross ./rpi-sysroot --app=analog-clock
./targets/rpi-display-1/scripts/geat-rpi.sh install pi@raspberrypi.local --app=analog-clock
ssh pi@raspberrypi.local 'GEA_RPI_APP_ID=analog-clock /opt/gea-embedded/apps/analog-clock/geat-app'
```

Liste için:
```bash
cat examples/apps.json | python3 -c "import json,sys; [print(a['id']) for a in json.load(sys.stdin)['apps']]"
```

---

## 9. Bilinen Kısıtlamalar (v1)

| Sınır | Detay |
| ----- | ----- |
| KMS backend | `display_kms.c` stub; linuxfb primary. Pi 3/4/5'te KMS Phase 2'de gelecek. |
| Multi-touch | Sadece ilk parmak işlenir. v2'de pinch/zoom eklenir. |
| IMU | Yok. `tilt-breakout` UI render edilir, tilt girişi olmadan. |
| BLE HID | Yok. Pi Zero W v1.1 BLE 4.1 yongası v2'de. |
| OTA update | Stub. `geat-rpi.sh install` ile manuel. |
| Image cache | Yok. `image-demo` Phase 4'te. |
| QuickJS | Submodule eklenmemiş. Sadece `app-render` runtime çalışır. |

---

## 10. Sık Sorulan Sorular

**S: Pi Zero gerçekten 30 fps verebiliyor mu?**
C: 410×502 compat viewport ile, dirty-rect aktif, statik UI: 60 fps; küçük animasyon: 30+ fps. Yoğun full-screen render (analog clock saniye akrep): 25-30 fps sınırında.

**S: Başka bir ekran takabilir miyim?**
C: Evet — `/boot/firmware/config.txt`'deki `hdmi_mode` değiştirilir, `display_linuxfb.c` mmap'i `mmap(..., g_fb_size, ...)` çağrısıyla dinamik olarak boyutlandırır. 1024×600 dışı çözünürlükler de çalışır, yalnız `compat` viewport'la harfboşluk oranı değişir.

**S: aarch64 Pi 4'üm var; aynı ikili çalışır mı?**
C: Hayır — Pi Zero binary'si armv6zk için derlenir (32-bit). Pi 4 için ayrı bir build gerekir: `cmake -DCMAKE_C_FLAGS=-march=armv8-a` veya Pi OS 64-bit kullanıyorsanız `aarch64` toolchain ile. Aynı kaynak kodu, farklı toolchain.

**S: USB touch yerine I2C touch kullanabilir miyim?**
C: Phase 3'te eklenecek. Şu an `GEA_RPI_INPUT=i2c:1:0x5d` set ederseniz, init -1 döner, touch çalışmaz. I2C touch için: `libmpsse` veya doğrudan `/dev/i2c-1` üzerinden yazmak gerekir (Phase 3).

**S: log_port=8081'i neden bağladık?**
C: ESP32 hedefiyle aynı TCP log kanalını kullanır. Simulator `nc localhost 8081` ile bağlanıp aynı mesaj formatını görür. Pi'de port **loopback**'e bağlı (güvenlik), başka bir makineden izlemek için `--port=0.0.0.0` env geçici olarak kullanılabilir.

---

## 11. Referanslar

- `targets/rpi-display-1/README.md` — Genel bakış
- `docs/rpi-target-plan.md` — Tam plan
- `targets/esp32-s3-touch-amoled-2.06/main/CMakeLists.txt` — ESP32 referans
- `docs/adding-a-target.md` — Yeni target ekleme kontrol listesi
- Waveshare 7inch HDMI LCD (C) wiki: https://www.waveshare.com/wiki/7inch_HDMI_LCD_(C)
- Raspberry Pi config.txt reference: https://www.raspberrypi.com/documentation/computers/configuration.html
