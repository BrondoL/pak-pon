# Print Agent Android App — Design Spec (Spec B)

**Date:** 2026-06-23
**Status:** Approved (brainstorming phase complete, ready for implementation plan)
**Scope:** Android native Kotlin app yang consume print job queue dari Supabase, kirim ESC/POS ke LAN printer dapur/minuman.
**Depends on:** Spec A web refactor (`docs/superpowers/specs/2026-06-23-print-nota-design.md`) — DB schema `print_queue` & `agent_heartbeats`, Supabase Realtime channel, web app POST jobs.

## 1. Latar belakang

Web app Pak Pon (Spec A) sudah refactored jadi producer pattern: POST print job ke `print_queue` table. Job ini perlu di-consume oleh sesuatu yang bisa kirim ESC/POS via TCP socket ke LAN printer iWare (port 9100) — yang TIDAK bisa dilakukan dari browser. Dipilih: build native Android app yang berjalan di tab kasir sebagai foreground service.

Alasan pivot dari approach awal (Android Intent URL ke RawBT) dijelaskan di Spec A §1.

## 2. Goal & non-goal

**Goal:**
- Background service di tab Android yang subscribe ke Supabase Realtime `print_queue`
- Receive job, identify target (dapur/minuman), open TCP socket ke IP printer yang sesuai, kirim ESC/POS bytes, close
- Report status (printing → done atau failed) ke DB via direct Supabase access
- Heartbeat tiap 30s ke `agent_heartbeats` (web banner cek ini untuk "agent online?")
- Minimal UI: login + settings (IPs, label) + status + history print + manual retry

**Non-goal (Spec C kalau perlu):**
- iOS version
- Multi-warung config
- Auto-discovery printer via mDNS
- Print job priority queue
- Crash reporting (Sentry/Crashlytics) — future
- App update via Play Store

## 3. Decisions ringkas

| # | Decision | Reason |
|---|---|---|
| Q1 | Bahasa: **Kotlin** | User belajar sekalian, foreground service native support, supabase-kt SDK, APK kecil |
| Q2 | UI framework: **Jetpack Compose** | Modern Google recommended, less boilerplate, declarative |
| Q3 | History: **always-fetch dari Supabase** (no local DB) | Simpler, single source of truth, tidak butuh sync logic |
| Q4 | Agent identification: **auto-UUID + user rename** (default "Tab-XXXX") | Unique guarantee + friendly label |
| Q5 | Build tools: **Gradle KTS** | Standard |
| Q6 | Min SDK: **API 26** (Android 8) | Foreground service properly + Compose support + 99% device coverage |
| Q7 | Target SDK: **API 34** (Android 14) | Latest stable, foreground service rules |
| Q8 | Credentials storage: **EncryptedSharedPreferences** (Android Keystore-derived key) | Best practice secure storage |
| Q9 | Settings storage: regular **SharedPreferences** (IPs, label, port) | Non-sensitive, fast read |
| Q10 | TCP client: **java.net.Socket direct** ke port 9100 | Standard, gak butuh ESC/POS library — bytes opaque |
| Q11 | Concurrency: **Kotlin Coroutines + StateFlow** | Idiomatic, async tanpa callback hell |
| Q12 | Service: **foreground service always-running**, START_STICKY, notification persistent | Reliable, OS-friendly |
| Q13 | Auto-start on boot: **opt-in via Settings** (BOOT_COMPLETED receiver) | Convenience tanpa zero-permission overhead |
| Q14 | Heartbeat interval: **30 detik** | Balance freshness vs Supabase write rate |
| Q15 | Retry strategy: **single-try, no auto-retry** | Konsisten dengan Spec A |
| Q16 | APK signing: **debug-signed dev, release-signed prod (lokal keystore)** | Standard |
| Q17 | Distribution: **sideload via Google Drive link** | Single warung, no Play Store cost |
| Q18 | Repo: **monorepo subfolder** (`pak-pon/print-agent/`) atau separate repo | Both viable, decide saat scaffolding |
| Q19 | Test setup: **JUnit unit + manual E2E**; integration test instrumented as time permits | YAGNI |
| Q20 | Backend access: **agent direct Supabase via SDK** (skip web API) | RLS protects, lebih efisien |

## 4. Architecture

### 4.1 Layer breakdown (MVVM)

```
┌─────────────────────────────────────────────────────┐
│ UI Layer (Jetpack Compose)                          │
│  LoginScreen + MainScreen (Status/History/Settings) │
│         │                                            │
│         ▼ (ViewModels: state holders)               │
└─────────────────────────────────────────────────────┘
                          │ uses
                          ▼
┌─────────────────────────────────────────────────────┐
│ Data Layer (Repositories)                           │
│  AuthRepository, PrintRepository,                   │
│  SettingsRepository, HeartbeatRepository            │
└─────────────────────────────────────────────────────┘
                          │ uses
                          ▼
┌─────────────────────────────────────────────────────┐
│ Infrastructure                                       │
│  SupabaseClient (wrapper around supabase-kt)        │
│  PrinterTcpClient (java.net.Socket)                 │
│  EncryptedSharedPreferences + SharedPreferences     │
└─────────────────────────────────────────────────────┘
                          ▲
                          │ started by
                          │
┌─────────────────────────────────────────────────────┐
│ Service                                              │
│  PrintAgentService (Foreground Service)             │
│   - subscribe Realtime print_queue                  │
│   - heartbeat coroutine (30s)                       │
│   - persistent notification                         │
└─────────────────────────────────────────────────────┘
```

### 4.2 Module structure

Single Gradle module `app`:

```
print-agent/
  app/
    src/main/
      kotlin/com/pakpon/printagent/
        MainActivity.kt
        PakPonAgentApplication.kt
        di/ServiceLocator.kt
        ui/
          login/{LoginScreen.kt, LoginViewModel.kt}
          main/{MainScreen.kt, MainViewModel.kt}
          settings/{SettingsScreen.kt, SettingsViewModel.kt}
          theme/{Color.kt, Theme.kt, Type.kt}
        data/
          auth/{AuthRepository.kt, SupabaseClient.kt}
          print/{PrintRepository.kt, PrintJob.kt}
          settings/{SettingsRepository.kt, EncryptedPrefsHelper.kt}
          heartbeat/HeartbeatRepository.kt
        service/{PrintAgentService.kt, NotificationFactory.kt, BootReceiver.kt}
        printer/PrinterTcpClient.kt
      AndroidManifest.xml
      res/...
    build.gradle.kts
  build.gradle.kts
  settings.gradle.kts
```

## 5. Data model

### 5.1 Kotlin data classes

```kotlin
@Serializable
data class PrintJob(
    val id: String,
    val tx_id: String?,
    val target: PrintTarget,
    val trigger: PrintTrigger,
    val bytes_b64: String,
    val status: PrintStatus,
    val failure_reason: String? = null,
    val created_by: String? = null,
    val created_at: String,
    val picked_up_at: String? = null,
    val completed_at: String? = null,
)

@Serializable enum class PrintTarget { dapur, minuman }
@Serializable enum class PrintTrigger { auto, reprint, test }
@Serializable enum class PrintStatus { pending, printing, done, failed }

@Serializable
data class HeartbeatRow(
    val agent_label: String,
    val last_seen_at: String,
    val agent_version: String? = null,
    val device_info: String? = null,
)
```

### 5.2 Local storage

**`EncryptedSharedPreferences` (`pak_pon_secure_prefs`)** — credentials only:
- `supabase_access_token`, `supabase_refresh_token`, `supabase_session_expiry`

**Regular `SharedPreferences` (`pak_pon_prefs`)** — settings:
- `printer_dapur_ip` (string)
- `printer_minuman_ip` (string)
- `printer_port` (int, default 9100)
- `agent_uuid` (string, generated first-launch)
- `agent_label` (string, default "Tab-XXXX")
- `auto_start_on_boot` (bool, default false)

**Build-time constants** (`BuildConfig`):
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` (injected dari `local.properties`)

## 6. Service lifecycle

### 6.1 `PrintAgentService`

Foreground service di-start setelah login success. Lifecycle:

| Trigger | Behavior |
|---|---|
| App first launch + login | `startForegroundService(PrintAgentService)` → notification persistent |
| App swipe-out recents | Service tetap jalan |
| HP reboot + auto-start enabled | `BootReceiver` start service |
| OS kill karena memory pressure | `START_STICKY` → OS auto-restart |
| Network drop | supabase-kt SDK auto-reconnect realtime channel; heartbeat coroutine continues with swallow-error |
| Manual stop button di UI | `stopSelf()`, notification hilang |

### 6.2 Main loops dalam service

```kotlin
class PrintAgentService : Service() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(NOTIFICATION_ID, NotificationFactory.buildPersistent(this))
    scope.launch { subscribeToPrintQueue() }
    scope.launch { startHeartbeatLoop() }
    return START_STICKY
  }

  private suspend fun subscribeToPrintQueue() {
    val channel = supabaseClient.channel("print-queue-agent")
    channel.postgresChangeFlow<PostgresAction.Insert>(schema = "public") {
      table = "print_queue"
    }.collect { event ->
      val job = parseJob(event.record)
      if (job.status == PrintStatus.pending) processJob(job)
    }
  }

  private suspend fun startHeartbeatLoop() {
    while (currentCoroutineContext().isActive) {
      runCatching { heartbeatRepo.sendHeartbeat() }
      delay(HEARTBEAT_INTERVAL_MS)
    }
  }

  private suspend fun processJob(job: PrintJob) {
    val ip = when (job.target) {
      PrintTarget.dapur -> settingsRepo.getDapurIp()
      PrintTarget.minuman -> settingsRepo.getMinumanIp()
    }
    if (ip.isNullOrBlank()) {
      printRepo.markFailed(job.id, "IP printer ${job.target} belum di-setup")
      return
    }
    printRepo.markPrinting(job.id)
    val bytes = Base64.decode(job.bytes_b64, Base64.DEFAULT)
    try {
      PrinterTcpClient.send(ip, settingsRepo.getPort(), bytes)
      printRepo.markDone(job.id)
    } catch (e: Exception) {
      printRepo.markFailed(job.id, e.message ?: "unknown TCP error")
    }
  }

  companion object {
    const val NOTIFICATION_ID = 1001
    const val CHANNEL_ID = "pak_pon_agent_channel"
    const val HEARTBEAT_INTERVAL_MS = 30_000L
  }
}
```

### 6.3 Notification (persistent)

```
🖨️  Pak Pon Print Agent
Online · printer dapur 192.168.1.50
[Open] [Stop]
```

Channel: low importance (no sound). Action buttons untuk open app & stop service.

### 6.4 Permissions

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
```

## 7. UI screens

### 7.1 Navigation

```
LoginScreen (skip kalau session valid)
    │
    ▼
MainScreen
  ├─ Tab: Status (default) — agent state + recent activity (last 5)
  ├─ Tab: History — list jobs + retry per failed
  └─ Tab: Settings — IPs, label, auto-start toggle, logout
```

### 7.2 Screen breakdown

| Screen | Components | Purpose |
|---|---|---|
| **LoginScreen** | Email field, password field, Login button, error display | Authenticate ke Supabase via email/pass |
| **MainScreen — Status** | Service status indicator (online/offline), last heartbeat time, recent 5 activity rows, Stop/Restart agent buttons | Real-time view kondisi agent |
| **MainScreen — History** | Filter chips (All/Today/Failed), table rows (time, target, trigger, status), retry button per failed row | Browse historical jobs, manual retry |
| **MainScreen — Settings** | Agent identity (label rename), printer dapur IP+port, printer minuman IP+port, Test connection buttons, Auto-start toggle, Save button, Logout button, App info | Configure agent |

### 7.3 ViewModel-state-flow per screen

| Screen | ViewModel | Dependencies | State exposed |
|---|---|---|---|
| LoginScreen | LoginViewModel | AuthRepository | `LoginUiState(loading, error, success)` |
| MainStatus | MainStatusViewModel | PrintRepository, HeartbeatRepository | `StatusUiState(agentOnline, lastHeartbeat, recentJobs)` |
| MainHistory | MainHistoryViewModel | PrintRepository | `HistoryUiState(jobs, filter, loading)` |
| MainSettings | MainSettingsViewModel | SettingsRepository, AuthRepository, PrinterTcpClient | `SettingsUiState(dapurIp, minumanIp, port, label, autoStart, dirty, testResult)` |

## 8. Build & distribute

### 8.1 Gradle setup

Reference Section 5 di brainstorming response untuk full `build.gradle.kts` template:
- Compose BOM, Material3, ActivityCompose
- Lifecycle/ViewModel Compose integration
- Kotlinx Coroutines Android
- Kotlinx Serialization JSON
- Supabase-kt: `postgrest-kt`, `realtime-kt`, `auth-kt` v3.0.0+
- Ktor client Android (Supabase transitive dep)
- AndroidX Security Crypto (`EncryptedSharedPreferences`)

### 8.2 `local.properties` (gitignored)

```properties
sdk.dir=/home/brondol/Android/Sdk
SUPABASE_URL=https://nqptpijfrccjuytrslwc.supabase.co
SUPABASE_ANON_KEY=eyJ...
RELEASE_KEYSTORE_PATH=/path/to/release.keystore
RELEASE_KEYSTORE_PASSWORD=...
RELEASE_KEY_ALIAS=...
RELEASE_KEY_PASSWORD=...
```

### 8.3 Keystore generation (one-time)

```bash
keytool -genkey -v -keystore release.keystore \
  -alias pakpon-print-agent -keyalg RSA -keysize 4096 -validity 10950
# Backup keystore + password (kalau hilang = gak bisa update app)
```

### 8.4 Build commands

```bash
# Debug build (dev iteration)
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Release build (untuk distribute)
./gradlew assembleRelease
# Output: app/build/outputs/apk/release/app-release.apk

# Logs
adb logcat -s "PakPonAgent" PakPon:V
```

### 8.5 Distribution & update flow

1. Dev build release APK lokal
2. Upload ke Google Drive (folder shared)
3. Kirim link Drive ke owner via WA
4. Owner: download → enable "install unknown sources" → install → login → setup IPs
5. Update: dev bump `versionCode` → build → overwrite Drive → WA notify → owner re-install (data preserved)

### 8.6 Neovim dev setup

(Detail di Section 5 brainstorming response.)

Required:
- JDK 17+
- Android SDK command-line tools (`platform-tools`, `build-tools;34.0.0`, `platforms;android-34`)
- Gradle (auto via wrapper)
- Neovim + `kotlin_language_server` (via Mason) + treesitter kotlin + ktlint

Workflow: scaffold project sekali via Android Studio (atau gradle init template), develop di Neovim, build via Gradle CLI, run on real device via ADB.

## 9. Testing strategy

### 9.1 Unit tests (JUnit + coroutines-test) — `src/test/`

| Component | Tests |
|---|---|
| `PrinterTcpClient` | Mock socket, verify bytes written + connect timeout + connection refused |
| `PrintRepository.processJobLogic` | Mock SupabaseClient, verify status transitions |
| `SettingsRepository` | InMemory prefs, verify get/set + defaults |
| `HeartbeatRepository` | Mock Supabase, verify UPSERT payload |
| ViewModels | Mock repos, verify state transitions |

### 9.2 Instrumented tests — `src/androidTest/`

| Component | Tests |
|---|---|
| `PrintAgentService` lifecycle | Espresso: start, verify notification, stop |
| `PrinterTcpClient` vs emulator | Pakai `scripts/printer-emulator.js` dari web project (Pak Pon), agent connect, verify bytes received |
| Encrypted prefs | Set/get/decrypt roundtrip |

### 9.3 Manual / E2E

1. Install agent APK pada device
2. Login dengan test Supabase account
3. Setup printer IP pointing ke printer-emulator.js di dev PC
4. Trigger test print dari Settings → verify byte arrives
5. Web POST queue job → verify agent receive & process
6. Disconnect WiFi → verify reconnect
7. Reboot device → verify auto-start (kalau enabled)

### 9.4 Cross-system verification

Full flow integration test setelah Spec A + Spec B both shipped:
- Web kasir confirm → POST queue → agent receives realtime → prints to emulator → status updates di web debug page

## 10. Error handling

| # | Skenario | Detection | Mitigation |
|---|---|---|---|
| 1 | Login gagal (wrong creds, network) | Supabase auth response | Show error message, retry |
| 2 | Token expired mid-session | Supabase auto-refresh | Transparent kalau refresh_token valid; kalau gak, re-login |
| 3 | Realtime subscription drop | supabase-kt callback | Auto-reconnect dengan backoff |
| 4 | TCP socket timeout | `java.net.Socket` exception | markFailed dengan reason "TCP timeout" |
| 5 | TCP connection refused (printer offline) | Socket exception | markFailed dengan reason "Connection refused" |
| 6 | IP belum di-setup | Settings check | markFailed dengan reason "IP printer X belum di-setup" |
| 7 | Service di-kill OS | START_STICKY restart | Auto-recover |
| 8 | Notification swipe (Android 14+) | Foreground service rule | Tidak bisa swipe (system prevents) |
| 9 | Encrypted prefs decrypt error (corrupted) | Keystore exception | Force re-login (clear prefs) |
| 10 | bytes_b64 decode error | Base64 exception | markFailed reason "invalid_payload" |

## 11. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| supabase-kt Realtime bugs/limitations | Medium | High | Spike early. Fallback: HTTP polling |
| OEM aggressive battery optimization kill foreground service (Xiaomi/Oppo/Vivo) | High at certain OEM | Medium | Tutorial: disable battery optimization khusus app ini |
| APK install blocked by Play Protect | Medium | Low | Owner approve "install anyway" once |
| Network printer IP berubah (DHCP) | Medium | Medium | Tutorial: assign static IP via router; future: hostname support |
| Duplicate agent_label | Low | Medium | UNIQUE constraint di DB, force rename on conflict |
| Token expired after long inactivity (>30d) | Low | Medium | supabase-kt auto-refresh; fallback force re-login |
| LAN printer firmware reject ESC/POS | Low | High | Use minimal subset (already in `lib/escpos.ts`) |
| Repo decision (mono vs separate) postponed | Low | Low | Decide at scaffolding, minimal impact |

## 12. Migration & deployment sequence

1. Spec A web refactor completed & merged (web POSTs to queue)
2. Scaffold print-agent project (sekali via Android Studio atau Gradle template)
3. Implement per plan tasks (kemungkinan ~20 task)
4. Owner-guided E2E test pada device real
5. Build release APK + sign
6. Upload Drive, WA notify owner
7. Owner install, login, setup printer IPs
8. Web kasir trigger print → verify end-to-end working

## 13. Out of scope

- ❌ iOS support
- ❌ Multi-warung config
- ❌ Auto-discovery printer via mDNS
- ❌ Print job priority queue
- ❌ ESC/POS preview di agent (bytes opaque)
- ❌ Background sync of historical jobs
- ❌ Auto-update from app store (manual via WA link)
- ❌ Crash reporting (Sentry/Crashlytics) — future
- ❌ App update notification in-app

## 14. Open decisions deferred to plan

- Repo structure: monorepo subfolder vs separate repo
- Theme/color palette untuk agent (match Pak Pon brand atau standard Material3)
- Localization (Bahasa Indonesia only atau dual ID/EN?)
- App icon/branding asset (placeholder OK at MVP)
