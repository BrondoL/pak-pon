# Print Agent Android App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Kotlin native Android app yang subscribe ke Supabase Realtime `print_queue`, terima job, kirim ESC/POS via TCP socket ke LAN printer (dapur/minuman), report status balik ke DB. Foreground service always-running + heartbeat. Login + settings + status + history UI dengan Jetpack Compose.

**Architecture:** MVVM (UI Compose + ViewModel + Repository + Infrastructure). Single Gradle module. Foreground service holds Realtime subscription + heartbeat coroutine. Direct Supabase SDK access (skip web API). Encrypted prefs untuk credentials, regular prefs untuk settings.

**Tech Stack:** Kotlin, Jetpack Compose Material3, Kotlin Coroutines + Flow, supabase-kt (postgrest + realtime + auth), Ktor Android, AndroidX Security Crypto, JUnit, Gradle KTS.

**Spec:** `docs/superpowers/specs/2026-06-23-print-agent-design.md`

**Depends on:** Spec A web refactor MUST be deployed first (DB schema + endpoints + realtime channel).

**Repo decision:** Monorepo subfolder — `print-agent/` di sebelah top-level Pak Pon project. Single git history, docs co-located.

**Branch:** Create new branch `feat/print-agent` dari master AFTER web Spec A merged.

---

## Pre-flight: Verify Spec A merged & env ready

Before starting Task 1, verify:
- Web Spec A merged ke master (branch `feat/print-nota` merged)
- Supabase migration 0005 applied
- `print_queue` & `agent_heartbeats` tables exist
- Realtime enabled untuk `print_queue`
- Test: POST job via web → row appears di Supabase Studio

Setup dev environment (one-time, ~30 min):

```bash
# Arch Linux setup
yay -S jdk17-openjdk android-tools android-sdk android-sdk-cmdline-tools-latest \
       android-sdk-platform-tools ktlint

# Set env vars (add ke ~/.zshrc or equivalent)
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

# Accept SDK licenses + install required components
sdkmanager --licenses
sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools" \
           "emulator" "system-images;android-34;google_apis;x86_64"

# (Optional) Create AVD untuk emulator testing
avdmanager create avd -n PakPonTest -k "system-images;android-34;google_apis;x86_64" -d "pixel_6"

# Verify ADB connection ke real device
adb devices

# Neovim LSP setup (via Mason atau manual)
# - install nvim-lspconfig
# - install mason.nvim
# - :MasonInstall kotlin-language-server
# - configure :LspConfig
```

---

## Task 1: Scaffold Gradle project structure

**Files:**
- Create: `print-agent/settings.gradle.kts`
- Create: `print-agent/build.gradle.kts`
- Create: `print-agent/gradle.properties`
- Create: `print-agent/gradle/wrapper/gradle-wrapper.properties`
- Create: `print-agent/gradlew` + `gradlew.bat`
- Create: `print-agent/app/build.gradle.kts`
- Create: `print-agent/.gitignore`
- Create: `print-agent/local.properties` (gitignored)

**Konteks:** Scaffold project lewat Gradle template karena pakai Neovim. Alternatively, generate sekali via Android Studio jika ada (lebih cepat, 5 menit). Tasks ini assume manual Gradle setup tanpa Android Studio.

- [ ] **Step 1: Create directory + initialize Gradle project**

```bash
mkdir -p print-agent/app/src/main/{kotlin/com/pakpon/printagent,res/{values,drawable,mipmap-hdpi,mipmap-xhdpi}}
mkdir -p print-agent/app/src/test/kotlin/com/pakpon/printagent
mkdir -p print-agent/app/src/androidTest/kotlin/com/pakpon/printagent
cd print-agent
gradle wrapper --gradle-version 8.9
```

Expected: `gradlew`, `gradlew.bat`, `gradle/wrapper/` files created.

- [ ] **Step 2: Tulis `print-agent/settings.gradle.kts`**

```kotlin
pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "PakPonPrintAgent"
include(":app")
```

- [ ] **Step 3: Tulis root `print-agent/build.gradle.kts`**

```kotlin
plugins {
    id("com.android.application") version "8.7.0" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}
```

- [ ] **Step 4: Tulis `print-agent/gradle.properties`**

```properties
org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official
```

- [ ] **Step 5: Tulis `print-agent/app/build.gradle.kts`**

```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.pakpon.printagent"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.pakpon.printagent"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "SUPABASE_URL",
            "\"${project.findProperty("SUPABASE_URL") ?: ""}\"")
        buildConfigField("String", "SUPABASE_ANON_KEY",
            "\"${project.findProperty("SUPABASE_ANON_KEY") ?: ""}\"")
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    signingConfigs {
        val keystorePath = project.findProperty("RELEASE_KEYSTORE_PATH") as String?
        if (!keystorePath.isNullOrBlank()) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = project.findProperty("RELEASE_KEYSTORE_PASSWORD") as String? ?: ""
                keyAlias = project.findProperty("RELEASE_KEY_ALIAS") as String? ?: ""
                keyPassword = project.findProperty("RELEASE_KEY_PASSWORD") as String? ?: ""
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    // Compose BOM
    implementation(platform("androidx.compose:compose-bom:2024.10.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.activity:activity-compose:1.9.3")

    // Lifecycle / ViewModel
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // Serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    // Supabase Kotlin SDK
    val supabaseVersion = "3.0.0"
    implementation("io.github.jan-tennert.supabase:postgrest-kt:$supabaseVersion")
    implementation("io.github.jan-tennert.supabase:realtime-kt:$supabaseVersion")
    implementation("io.github.jan-tennert.supabase:auth-kt:$supabaseVersion")

    // Ktor (Supabase HTTP transport)
    implementation("io.ktor:ktor-client-android:3.0.0")

    // Encrypted SharedPreferences
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Testing
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("io.mockk:mockk:1.13.13")

    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation(platform("androidx.compose:compose-bom:2024.10.00"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
}
```

- [ ] **Step 6: Tulis `print-agent/.gitignore`**

```
*.iml
.gradle/
.idea/
build/
gradle/wrapper/gradle-wrapper.jar
local.properties
captures/
.externalNativeBuild/
.cxx/
*.apk
release/
*.keystore
*.jks
```

- [ ] **Step 7: Tulis `print-agent/local.properties` (jangan commit!)**

```properties
sdk.dir=/home/brondol/Android/Sdk
SUPABASE_URL=https://nqptpijfrccjuytrslwc.supabase.co
SUPABASE_ANON_KEY=eyJ...PASTE_FROM_SUPABASE_DASHBOARD
```

Owner-side later: `RELEASE_KEYSTORE_PATH` dst saat siap release build.

- [ ] **Step 8: Verify scaffold OK**

```bash
cd print-agent
./gradlew tasks
```

Expected: list of Gradle tasks tampil, no errors.

- [ ] **Step 9: Commit**

```bash
git checkout -b feat/print-agent
git add print-agent/build.gradle.kts print-agent/settings.gradle.kts \
        print-agent/gradle.properties print-agent/gradle/ print-agent/gradlew \
        print-agent/gradlew.bat print-agent/app/build.gradle.kts \
        print-agent/.gitignore
git commit -m "feat(agent): scaffold Gradle project with Compose + supabase-kt deps"
```

---

## Task 2: AndroidManifest + base resources

**Files:**
- Create: `print-agent/app/src/main/AndroidManifest.xml`
- Create: `print-agent/app/src/main/res/values/strings.xml`
- Create: `print-agent/app/src/main/res/values/themes.xml`
- Create: `print-agent/app/src/main/res/values/colors.xml`
- Create: `print-agent/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- Create: `print-agent/app/src/main/res/drawable/ic_notification.xml`

- [ ] **Step 1: Tulis `AndroidManifest.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />

    <application
        android:name=".PakPonAgentApplication"
        android:allowBackup="false"
        android:dataExtractionRules="@xml/data_extraction_rules"
        android:fullBackupContent="false"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="false"
        android:theme="@style/Theme.PakPonAgent">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTask"
            android:screenOrientation="portrait"
            android:theme="@style/Theme.PakPonAgent">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <service
            android:name=".service.PrintAgentService"
            android:foregroundServiceType="dataSync"
            android:exported="false" />

        <receiver
            android:name=".service.BootReceiver"
            android:enabled="true"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
            </intent-filter>
        </receiver>
    </application>
</manifest>
```

- [ ] **Step 2: Tulis `res/values/strings.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Pak Pon Agent</string>
    <string name="notification_channel_name">Print Agent</string>
    <string name="notification_channel_description">Status agent print</string>
    <string name="notification_title">Pak Pon Print Agent</string>
    <string name="notification_text_online">Online &amp; siap cetak</string>
    <string name="notification_action_open">Buka</string>
    <string name="notification_action_stop">Stop</string>
</resources>
```

- [ ] **Step 3: Tulis `res/values/colors.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#FAF7F0</color>
</resources>
```

- [ ] **Step 4: Tulis `res/values/themes.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:tools="http://schemas.android.com/tools">
    <style name="Theme.PakPonAgent" parent="android:Theme.Material.Light.NoActionBar">
        <item name="android:windowSplashScreenBackground">@color/ic_launcher_background</item>
    </style>
</resources>
```

- [ ] **Step 5: Tulis `res/xml/data_extraction_rules.xml`**

```bash
mkdir -p print-agent/app/src/main/res/xml
```

```xml
<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="sharedpref" path="pak_pon_secure_prefs.xml"/>
    </cloud-backup>
    <device-transfer>
        <exclude domain="sharedpref" path="pak_pon_secure_prefs.xml"/>
    </device-transfer>
</data-extraction-rules>
```

- [ ] **Step 6: Tulis placeholder launcher icons** (vector drawables yang simple)

`res/mipmap-anydpi-v26/ic_launcher.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
```

`res/mipmap-anydpi-v26/ic_launcher_round.xml`: copy isi `ic_launcher.xml` (same content).

`res/drawable/ic_launcher_foreground.xml`:
```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path
        android:fillColor="#D02D1F"
        android:pathData="M30,30 L78,30 L78,78 L30,78 Z M40,40 L68,40 L68,68 L40,68 Z" />
</vector>
```

`res/drawable/ic_notification.xml`:
```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="24" android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M19,8h-1V3H6v5H5c-1.66,0 -3,1.34 -3,3v6h4v4h12v-4h4v-6c0,-1.66 -1.34,-3 -3,-3zM8,5h8v3H8V5zM16,19H8v-5h8v5zM19,12c-0.55,0 -1,-0.45 -1,-1s0.45,-1 1,-1 1,0.45 1,1 -0.45,1 -1,1z" />
</vector>
```

- [ ] **Step 7: Verify manifest valid**

```bash
cd print-agent
./gradlew :app:checkDebugManifest
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add print-agent/app/src/main/AndroidManifest.xml print-agent/app/src/main/res/
git commit -m "feat(agent): AndroidManifest with permissions + base resources (icons, strings, theme)"
```

---

## Task 3: Data classes (PrintJob, HeartbeatRow, enums)

**Files:**
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/data/print/PrintJob.kt`
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/data/heartbeat/HeartbeatRow.kt`

- [ ] **Step 1: Tulis `data/print/PrintJob.kt`**

```kotlin
package com.pakpon.printagent.data.print

import kotlinx.serialization.Serializable

@Serializable
enum class PrintTarget {
    dapur,
    minuman,
}

@Serializable
enum class PrintTrigger {
    auto,
    reprint,
    test,
}

@Serializable
enum class PrintStatus {
    pending,
    printing,
    done,
    failed,
}

@Serializable
data class PrintJob(
    val id: String,
    val tx_id: String? = null,
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
```

- [ ] **Step 2: Tulis `data/heartbeat/HeartbeatRow.kt`**

```kotlin
package com.pakpon.printagent.data.heartbeat

import kotlinx.serialization.Serializable

@Serializable
data class HeartbeatRow(
    val agent_label: String,
    val last_seen_at: String,
    val agent_version: String? = null,
    val device_info: String? = null,
)

@Serializable
data class HeartbeatUpsert(
    val agent_label: String,
    val last_seen_at: String,
    val agent_version: String,
    val device_info: String,
)
```

- [ ] **Step 3: Verify compile**

```bash
cd print-agent
./gradlew :app:compileDebugKotlin
```

Expected: build succeeds (warnings OK for now since data classes have no consumers yet).

- [ ] **Step 4: Commit**

```bash
git add print-agent/app/src/main/kotlin/com/pakpon/printagent/data/
git commit -m "feat(agent): PrintJob, HeartbeatRow data classes + enums"
```

---

## Task 4: `SettingsRepository` + EncryptedPrefs helper

**Files:**
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/data/settings/EncryptedPrefsHelper.kt`
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/data/settings/SettingsRepository.kt`
- Create: `print-agent/app/src/test/kotlin/com/pakpon/printagent/data/settings/SettingsRepositoryTest.kt`

- [ ] **Step 1: Tulis `EncryptedPrefsHelper.kt`**

```kotlin
package com.pakpon.printagent.data.settings

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

object EncryptedPrefsHelper {
    private const val SECURE_PREFS_FILE = "pak_pon_secure_prefs"

    fun create(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            SECURE_PREFS_FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }
}
```

- [ ] **Step 2: Tulis `SettingsRepository.kt`**

```kotlin
package com.pakpon.printagent.data.settings

import android.content.Context
import android.content.SharedPreferences
import java.util.UUID

class SettingsRepository(
    context: Context,
) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)

    // — Agent identity —

    fun getAgentUuid(): String {
        val existing = prefs.getString(KEY_AGENT_UUID, null)
        if (existing != null) return existing
        val generated = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_AGENT_UUID, generated).apply()
        return generated
    }

    fun getAgentLabel(): String {
        val existing = prefs.getString(KEY_AGENT_LABEL, null)
        if (existing != null) return existing
        // Default: "Tab-XXXX" (last 4 chars of UUID, uppercased)
        val uuid = getAgentUuid()
        val defaultLabel = "Tab-${uuid.takeLast(4).uppercase()}"
        prefs.edit().putString(KEY_AGENT_LABEL, defaultLabel).apply()
        return defaultLabel
    }

    fun setAgentLabel(label: String) {
        prefs.edit().putString(KEY_AGENT_LABEL, label.trim()).apply()
    }

    // — Printer config —

    fun getDapurIp(): String? = prefs.getString(KEY_DAPUR_IP, null)?.takeIf { it.isNotBlank() }
    fun getMinumanIp(): String? = prefs.getString(KEY_MINUMAN_IP, null)?.takeIf { it.isNotBlank() }
    fun getPort(): Int = prefs.getInt(KEY_PORT, DEFAULT_PORT)

    fun setDapurIp(ip: String) {
        prefs.edit().putString(KEY_DAPUR_IP, ip.trim()).apply()
    }

    fun setMinumanIp(ip: String) {
        prefs.edit().putString(KEY_MINUMAN_IP, ip.trim()).apply()
    }

    fun setPort(port: Int) {
        prefs.edit().putInt(KEY_PORT, port).apply()
    }

    // — Boot auto-start —

    fun isAutoStartOnBoot(): Boolean = prefs.getBoolean(KEY_AUTO_START_BOOT, false)
    fun setAutoStartOnBoot(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_AUTO_START_BOOT, enabled).apply()
    }

    companion object {
        const val PREFS_FILE = "pak_pon_prefs"
        const val KEY_AGENT_UUID = "agent_uuid"
        const val KEY_AGENT_LABEL = "agent_label"
        const val KEY_DAPUR_IP = "printer_dapur_ip"
        const val KEY_MINUMAN_IP = "printer_minuman_ip"
        const val KEY_PORT = "printer_port"
        const val KEY_AUTO_START_BOOT = "auto_start_on_boot"
        const val DEFAULT_PORT = 9100
    }
}
```

- [ ] **Step 3: Tulis unit test `SettingsRepositoryTest.kt`**

```kotlin
package com.pakpon.printagent.data.settings

import android.content.Context
import android.content.SharedPreferences
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SettingsRepositoryTest {

    private fun makeFakeRepo(initial: Map<String, Any> = emptyMap()): Pair<SettingsRepository, FakePrefs> {
        val context = mockk<Context>()
        val fake = FakePrefs(initial.toMutableMap())
        every { context.getSharedPreferences(SettingsRepository.PREFS_FILE, Context.MODE_PRIVATE) } returns fake
        return SettingsRepository(context) to fake
    }

    @Test
    fun `getAgentUuid generates UUID on first call & persists`() {
        val (repo, fake) = makeFakeRepo()
        val uuid1 = repo.getAgentUuid()
        val uuid2 = repo.getAgentUuid()
        assertNotNull(uuid1)
        assertEquals(uuid1, uuid2)
        assertEquals(uuid1, fake.store[SettingsRepository.KEY_AGENT_UUID])
    }

    @Test
    fun `getAgentLabel default is Tab-XXXX based on UUID`() {
        val (repo, _) = makeFakeRepo()
        val label = repo.getAgentLabel()
        assertTrue(label.startsWith("Tab-"))
        assertEquals(8, label.length)  // "Tab-" + 4 chars
    }

    @Test
    fun `setAgentLabel persists trimmed value`() {
        val (repo, fake) = makeFakeRepo()
        repo.setAgentLabel("  My Tab  ")
        assertEquals("My Tab", fake.store[SettingsRepository.KEY_AGENT_LABEL])
    }

    @Test
    fun `getDapurIp returns null when unset or blank`() {
        val (repo, _) = makeFakeRepo()
        assertNull(repo.getDapurIp())
        repo.setDapurIp("   ")
        assertNull(repo.getDapurIp())
    }

    @Test
    fun `getDapurIp returns trimmed value when set`() {
        val (repo, _) = makeFakeRepo()
        repo.setDapurIp("  192.168.1.50  ")
        assertEquals("192.168.1.50", repo.getDapurIp())
    }

    @Test
    fun `getPort default is 9100`() {
        val (repo, _) = makeFakeRepo()
        assertEquals(9100, repo.getPort())
    }

    @Test
    fun `setPort persists custom value`() {
        val (repo, fake) = makeFakeRepo()
        repo.setPort(9200)
        assertEquals(9200, fake.store[SettingsRepository.KEY_PORT])
    }

    @Test
    fun `isAutoStartOnBoot default false`() {
        val (repo, _) = makeFakeRepo()
        assertFalse(repo.isAutoStartOnBoot())
    }
}

/**
 * Minimal in-memory SharedPreferences fake for unit testing.
 * Supports getString/getInt/getBoolean and edit().putString/putInt/putBoolean.apply().
 */
class FakePrefs(val store: MutableMap<String, Any?> = mutableMapOf()) : SharedPreferences {
    override fun getString(key: String?, defValue: String?): String? = store[key] as? String ?: defValue
    override fun getInt(key: String?, defValue: Int): Int = (store[key] as? Int) ?: defValue
    override fun getBoolean(key: String?, defValue: Boolean): Boolean = (store[key] as? Boolean) ?: defValue
    override fun edit(): SharedPreferences.Editor = FakeEditor(store)
    override fun contains(key: String?): Boolean = store.containsKey(key)
    override fun getAll(): MutableMap<String, *> = store.toMutableMap()
    override fun getLong(key: String?, defValue: Long): Long = (store[key] as? Long) ?: defValue
    override fun getFloat(key: String?, defValue: Float): Float = (store[key] as? Float) ?: defValue
    override fun getStringSet(key: String?, defValues: MutableSet<String>?) = store[key] as? MutableSet<String> ?: defValues
    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}
    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}
}

class FakeEditor(private val store: MutableMap<String, Any?>) : SharedPreferences.Editor {
    override fun putString(key: String?, value: String?): SharedPreferences.Editor = apply { if (key != null) store[key] = value }
    override fun putInt(key: String?, value: Int): SharedPreferences.Editor = apply { if (key != null) store[key] = value }
    override fun putBoolean(key: String?, value: Boolean): SharedPreferences.Editor = apply { if (key != null) store[key] = value }
    override fun putLong(key: String?, value: Long): SharedPreferences.Editor = apply { if (key != null) store[key] = value }
    override fun putFloat(key: String?, value: Float): SharedPreferences.Editor = apply { if (key != null) store[key] = value }
    override fun putStringSet(key: String?, values: MutableSet<String>?): SharedPreferences.Editor = apply { if (key != null) store[key] = values }
    override fun remove(key: String?): SharedPreferences.Editor = apply { store.remove(key) }
    override fun clear(): SharedPreferences.Editor = apply { store.clear() }
    override fun apply() {}
    override fun commit(): Boolean = true
}
```

- [ ] **Step 4: Run test**

```bash
cd print-agent
./gradlew :app:testDebugUnitTest --tests "com.pakpon.printagent.data.settings.SettingsRepositoryTest"
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add print-agent/app/src/main/kotlin/com/pakpon/printagent/data/settings/ \
        print-agent/app/src/test/kotlin/com/pakpon/printagent/data/settings/
git commit -m "feat(agent): SettingsRepository + EncryptedPrefs helper with 8 tests"
```

---

## Task 5: `SupabaseClient` wrapper

**Files:**
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/data/auth/SupabaseClient.kt`

- [ ] **Step 1: Tulis `SupabaseClient.kt`**

```kotlin
package com.pakpon.printagent.data.auth

import com.pakpon.printagent.BuildConfig
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.realtime.Realtime

object SupabaseClientFactory {
    private var instance: SupabaseClient? = null

    fun get(): SupabaseClient {
        if (instance == null) {
            instance = createSupabaseClient(
                supabaseUrl = BuildConfig.SUPABASE_URL,
                supabaseKey = BuildConfig.SUPABASE_ANON_KEY,
            ) {
                install(Auth)
                install(Postgrest)
                install(Realtime)
            }
        }
        return instance!!
    }
}
```

- [ ] **Step 2: Verify compile**

```bash
cd print-agent
./gradlew :app:compileDebugKotlin
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add print-agent/app/src/main/kotlin/com/pakpon/printagent/data/auth/SupabaseClient.kt
git commit -m "feat(agent): SupabaseClient singleton factory"
```

---

## Task 6: `AuthRepository`

**Files:**
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/data/auth/AuthRepository.kt`

- [ ] **Step 1: Tulis `AuthRepository.kt`**

```kotlin
package com.pakpon.printagent.data.auth

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.SessionStatus
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.user.UserSession
import kotlinx.coroutines.flow.Flow

class AuthRepository(
    private val supabase: SupabaseClient,
) {
    val sessionStatus: Flow<SessionStatus> = supabase.auth.sessionStatus

    fun currentSession(): UserSession? = supabase.auth.currentSessionOrNull()

    suspend fun signIn(email: String, password: String) {
        supabase.auth.signInWith(Email) {
            this.email = email.trim()
            this.password = password
        }
    }

    suspend fun signOut() {
        supabase.auth.signOut()
    }

    fun isLoggedIn(): Boolean = currentSession() != null
}
```

- [ ] **Step 2: Verify compile**

```bash
cd print-agent
./gradlew :app:compileDebugKotlin
```

- [ ] **Step 3: Commit**

```bash
git add print-agent/app/src/main/kotlin/com/pakpon/printagent/data/auth/AuthRepository.kt
git commit -m "feat(agent): AuthRepository wrapper (signIn, signOut, session)"
```

---

## Task 7: `PrinterTcpClient`

**Files:**
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/printer/PrinterTcpClient.kt`
- Create: `print-agent/app/src/test/kotlin/com/pakpon/printagent/printer/PrinterTcpClientTest.kt`

- [ ] **Step 1: Tulis test `PrinterTcpClientTest.kt`**

```kotlin
package com.pakpon.printagent.printer

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import kotlin.test.assertContentEquals
import kotlin.test.assertFailsWith

class PrinterTcpClientTest {
    private lateinit var serverSocket: ServerSocket
    private val receivedBytes = AtomicReference<ByteArray?>()

    @Before
    fun setup() {
        serverSocket = ServerSocket(0) // random port
        receivedBytes.set(null)
        thread {
            try {
                val client = serverSocket.accept()
                receivedBytes.set(client.getInputStream().readBytes())
                client.close()
            } catch (_: Exception) {
                // server closed
            }
        }
    }

    @After
    fun tearDown() {
        serverSocket.close()
    }

    @Test
    fun `send transmits bytes to TCP server`() = runTest {
        val testBytes = byteArrayOf(0x1B, 0x40, 0x48, 0x49) // ESC @ H I
        PrinterTcpClient.send("127.0.0.1", serverSocket.localPort, testBytes)
        // Give server thread time to read
        Thread.sleep(200)
        assertContentEquals(testBytes, receivedBytes.get())
    }

    @Test
    fun `send throws on connect timeout (unreachable IP)`() = runTest {
        // 192.0.2.0/24 is reserved for documentation, unroutable
        assertFailsWith<Exception> {
            PrinterTcpClient.send("192.0.2.1", 9100, byteArrayOf(0x00), connectTimeoutMs = 500)
        }
    }
}
```

- [ ] **Step 2: Tulis `PrinterTcpClient.kt`**

```kotlin
package com.pakpon.printagent.printer

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.InetSocketAddress
import java.net.Socket

object PrinterTcpClient {
    const val DEFAULT_CONNECT_TIMEOUT_MS = 5000
    const val DEFAULT_WRITE_TIMEOUT_MS = 5000

    suspend fun send(
        ip: String,
        port: Int,
        bytes: ByteArray,
        connectTimeoutMs: Int = DEFAULT_CONNECT_TIMEOUT_MS,
        writeTimeoutMs: Int = DEFAULT_WRITE_TIMEOUT_MS,
    ) = withContext(Dispatchers.IO) {
        Socket().use { socket ->
            socket.connect(InetSocketAddress(ip, port), connectTimeoutMs)
            socket.soTimeout = writeTimeoutMs
            socket.getOutputStream().use { out ->
                out.write(bytes)
                out.flush()
            }
        }
    }
}
```

- [ ] **Step 3: Run test**

```bash
cd print-agent
./gradlew :app:testDebugUnitTest --tests "com.pakpon.printagent.printer.PrinterTcpClientTest"
```

Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add print-agent/app/src/main/kotlin/com/pakpon/printagent/printer/ \
        print-agent/app/src/test/kotlin/com/pakpon/printagent/printer/
git commit -m "feat(agent): PrinterTcpClient with 2 tests (success + timeout)"
```

---

## Task 8: `PrintRepository`

**Files:**
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/data/print/PrintRepository.kt`

- [ ] **Step 1: Tulis `PrintRepository.kt`**

```kotlin
package com.pakpon.printagent.data.print

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import java.time.Instant

class PrintRepository(
    private val supabase: SupabaseClient,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {
    /**
     * Subscribe ke INSERT events di print_queue table.
     * Emit PrintJob saat row baru muncul dengan status='pending'.
     */
    fun observePendingJobs(): Flow<PrintJob> {
        val channel = supabase.channel(CHANNEL_NAME)
        val flow = channel.postgresChangeFlow<PostgresAction.Insert>(schema = "public") {
            table = TABLE_NAME
        }.map { event ->
            json.decodeFromJsonElement(PrintJob.serializer(), event.record.jsonObject as kotlinx.serialization.json.JsonElement)
        }.filter { it.status == PrintStatus.pending }
        // Channel subscription started by caller via channel.subscribe()
        return flow
    }

    suspend fun fetchRecent(limit: Int = 20, statusFilter: PrintStatus? = null): List<PrintJob> {
        val query = supabase.from(TABLE_NAME).select(columns = io.github.jan.supabase.postgrest.query.Columns.list(
            "id, tx_id, target, trigger, bytes_b64, status, failure_reason, created_by, created_at, picked_up_at, completed_at"
        )) {
            order("created_at", Order.DESCENDING)
            limit(limit.toLong())
            if (statusFilter != null) {
                filter { eq("status", statusFilter.name) }
            }
        }
        return query.decodeList<PrintJob>()
    }

    suspend fun markPrinting(jobId: String) {
        supabase.from(TABLE_NAME).update({
            set("status", PrintStatus.printing.name)
            set("picked_up_at", Instant.now().toString())
        }) {
            filter { eq("id", jobId) }
        }
    }

    suspend fun markDone(jobId: String) {
        supabase.from(TABLE_NAME).update({
            set("status", PrintStatus.done.name)
            set("completed_at", Instant.now().toString())
            set("failure_reason", null as String?)
        }) {
            filter { eq("id", jobId) }
        }
    }

    suspend fun markFailed(jobId: String, reason: String) {
        supabase.from(TABLE_NAME).update({
            set("status", PrintStatus.failed.name)
            set("completed_at", Instant.now().toString())
            set("failure_reason", reason.take(MAX_REASON_LENGTH))
        }) {
            filter { eq("id", jobId) }
        }
    }

    suspend fun retry(jobId: String) {
        supabase.from(TABLE_NAME).update({
            set("status", PrintStatus.pending.name)
            set("failure_reason", null as String?)
            set("completed_at", null as String?)
            set("picked_up_at", null as String?)
        }) {
            filter {
                eq("id", jobId)
                eq("status", PrintStatus.failed.name) // safety
            }
        }
    }

    companion object {
        const val CHANNEL_NAME = "print-queue-agent"
        const val TABLE_NAME = "print_queue"
        const val MAX_REASON_LENGTH = 500
    }
}
```

- [ ] **Step 2: Verify compile**

```bash
cd print-agent
./gradlew :app:compileDebugKotlin
```

- [ ] **Step 3: Commit**

```bash
git add print-agent/app/src/main/kotlin/com/pakpon/printagent/data/print/PrintRepository.kt
git commit -m "feat(agent): PrintRepository (subscribe pending, fetch recent, mark status, retry)"
```

---

## Task 9: `HeartbeatRepository`

**Files:**
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/data/heartbeat/HeartbeatRepository.kt`

- [ ] **Step 1: Tulis `HeartbeatRepository.kt`**

```kotlin
package com.pakpon.printagent.data.heartbeat

import com.pakpon.printagent.BuildConfig
import com.pakpon.printagent.data.settings.SettingsRepository
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import java.time.Instant

class HeartbeatRepository(
    private val supabase: SupabaseClient,
    private val settings: SettingsRepository,
    private val deviceInfo: String,
) {
    /**
     * UPSERT heartbeat row keyed by agent_label.
     * Conflict resolution: ON CONFLICT (agent_label) DO UPDATE.
     */
    suspend fun sendHeartbeat() {
        val label = settings.getAgentLabel()
        val row = HeartbeatUpsert(
            agent_label = label,
            last_seen_at = Instant.now().toString(),
            agent_version = BuildConfig.VERSION_NAME,
            device_info = deviceInfo,
        )
        supabase.from(TABLE_NAME).upsert(row) {
            onConflict = "agent_label"
        }
    }

    suspend fun fetchAll(): List<HeartbeatRow> {
        return supabase.from(TABLE_NAME).select(columns = Columns.list(
            "agent_label, last_seen_at, agent_version, device_info"
        )) {
            order("last_seen_at", Order.DESCENDING)
        }.decodeList<HeartbeatRow>()
    }

    companion object {
        const val TABLE_NAME = "agent_heartbeats"
    }
}
```

- [ ] **Step 2: Verify compile**

```bash
cd print-agent
./gradlew :app:compileDebugKotlin
```

- [ ] **Step 3: Commit**

```bash
git add print-agent/app/src/main/kotlin/com/pakpon/printagent/data/heartbeat/
git commit -m "feat(agent): HeartbeatRepository (UPSERT keyed by agent_label)"
```

---

## Task 10: ServiceLocator (manual DI)

**Files:**
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/di/ServiceLocator.kt`

- [ ] **Step 1: Tulis `ServiceLocator.kt`**

```kotlin
package com.pakpon.printagent.di

import android.content.Context
import android.os.Build
import com.pakpon.printagent.data.auth.AuthRepository
import com.pakpon.printagent.data.auth.SupabaseClientFactory
import com.pakpon.printagent.data.heartbeat.HeartbeatRepository
import com.pakpon.printagent.data.print.PrintRepository
import com.pakpon.printagent.data.settings.SettingsRepository

/**
 * Manual dependency injection container. Initialized in Application.onCreate().
 * Use ServiceLocator.<repo> from anywhere.
 */
object ServiceLocator {
    private var initialized = false

    lateinit var settingsRepository: SettingsRepository
        private set
    lateinit var authRepository: AuthRepository
        private set
    lateinit var printRepository: PrintRepository
        private set
    lateinit var heartbeatRepository: HeartbeatRepository
        private set

    fun init(appContext: Context) {
        if (initialized) return
        val supabase = SupabaseClientFactory.get()
        settingsRepository = SettingsRepository(appContext)
        authRepository = AuthRepository(supabase)
        printRepository = PrintRepository(supabase)
        val deviceInfo = "${Build.MANUFACTURER} ${Build.MODEL} (Android ${Build.VERSION.RELEASE})"
        heartbeatRepository = HeartbeatRepository(supabase, settingsRepository, deviceInfo)
        initialized = true
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add print-agent/app/src/main/kotlin/com/pakpon/printagent/di/
git commit -m "feat(agent): ServiceLocator for manual dependency injection"
```

---

## Task 11: `NotificationFactory`

**Files:**
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/service/NotificationFactory.kt`

- [ ] **Step 1: Tulis `NotificationFactory.kt`**

```kotlin
package com.pakpon.printagent.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.pakpon.printagent.MainActivity
import com.pakpon.printagent.R

object NotificationFactory {
    const val CHANNEL_ID = "pak_pon_agent_channel"
    const val NOTIFICATION_ID = 1001

    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = context.getString(R.string.notification_channel_description)
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    fun buildPersistent(context: Context, statusText: String? = null): Notification {
        ensureChannel(context)
        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openPi = PendingIntent.getActivity(
            context, 0, openIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val stopIntent = Intent(context, PrintAgentService::class.java).apply {
            action = PrintAgentService.ACTION_STOP
        }
        val stopPi = PendingIntent.getService(
            context, 1, stopIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.notification_title))
            .setContentText(statusText ?: context.getString(R.string.notification_text_online))
            .setContentIntent(openPi)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .addAction(0, context.getString(R.string.notification_action_open), openPi)
            .addAction(0, context.getString(R.string.notification_action_stop), stopPi)
            .build()
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add print-agent/app/src/main/kotlin/com/pakpon/printagent/service/NotificationFactory.kt
git commit -m "feat(agent): NotificationFactory for persistent foreground notification"
```

---

## Task 12: `PrintAgentService` (foreground service)

**Files:**
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/service/PrintAgentService.kt`

- [ ] **Step 1: Tulis `PrintAgentService.kt`**

```kotlin
package com.pakpon.printagent.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Base64
import android.util.Log
import com.pakpon.printagent.data.print.PrintJob
import com.pakpon.printagent.data.print.PrintStatus
import com.pakpon.printagent.data.print.PrintTarget
import com.pakpon.printagent.di.ServiceLocator
import com.pakpon.printagent.printer.PrinterTcpClient
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class PrintAgentService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            Log.i(TAG, "Stop action received, shutting down")
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        Log.i(TAG, "Starting foreground service")
        startForeground(
            NotificationFactory.NOTIFICATION_ID,
            NotificationFactory.buildPersistent(this),
        )

        scope.launch { subscribeToPrintQueue() }
        scope.launch { startHeartbeatLoop() }

        return START_STICKY
    }

    private suspend fun subscribeToPrintQueue() {
        Log.i(TAG, "Subscribing to print_queue realtime")
        try {
            val supabase = com.pakpon.printagent.data.auth.SupabaseClientFactory.get()
            supabase.realtime.connect()
            ServiceLocator.printRepository.observePendingJobs().collect { job ->
                Log.i(TAG, "Received pending job ${job.id} target=${job.target}")
                runCatching { processJob(job) }.onFailure { e ->
                    Log.e(TAG, "Job processing crashed", e)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "subscribeToPrintQueue failed; will rely on START_STICKY restart", e)
        }
    }

    private suspend fun startHeartbeatLoop() {
        Log.i(TAG, "Heartbeat loop start (interval ${HEARTBEAT_INTERVAL_MS}ms)")
        while (currentCoroutineContext().isActive) {
            try {
                ServiceLocator.heartbeatRepository.sendHeartbeat()
            } catch (e: Exception) {
                Log.w(TAG, "Heartbeat send failed (will retry next tick): ${e.message}")
            }
            delay(HEARTBEAT_INTERVAL_MS)
        }
    }

    private suspend fun processJob(job: PrintJob) {
        val settings = ServiceLocator.settingsRepository
        val ip = when (job.target) {
            PrintTarget.dapur -> settings.getDapurIp()
            PrintTarget.minuman -> settings.getMinumanIp()
        }

        if (ip.isNullOrBlank()) {
            ServiceLocator.printRepository.markFailed(
                job.id,
                "IP printer ${job.target} belum di-setup di agent Settings",
            )
            return
        }

        ServiceLocator.printRepository.markPrinting(job.id)
        val bytes = Base64.decode(job.bytes_b64, Base64.DEFAULT)
        try {
            PrinterTcpClient.send(ip, settings.getPort(), bytes)
            ServiceLocator.printRepository.markDone(job.id)
            Log.i(TAG, "Job ${job.id} printed successfully to ${job.target} @ $ip")
        } catch (e: Exception) {
            val reason = e.message ?: e.javaClass.simpleName
            ServiceLocator.printRepository.markFailed(job.id, reason)
            Log.w(TAG, "Job ${job.id} failed: $reason")
        }
    }

    override fun onDestroy() {
        Log.i(TAG, "Service onDestroy, cancelling scope")
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val TAG = "PakPonAgent"
        const val HEARTBEAT_INTERVAL_MS = 30_000L
        const val ACTION_STOP = "com.pakpon.printagent.STOP"

        fun start(context: Context) {
            val intent = Intent(context, PrintAgentService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, PrintAgentService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }
}
```

- [ ] **Step 2: Verify compile**

```bash
cd print-agent
./gradlew :app:compileDebugKotlin
```

- [ ] **Step 3: Commit**

```bash
git add print-agent/app/src/main/kotlin/com/pakpon/printagent/service/PrintAgentService.kt
git commit -m "feat(agent): PrintAgentService foreground service (realtime sub + heartbeat + process job)"
```

---

## Task 13: `BootReceiver`

**Files:**
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/service/BootReceiver.kt`

- [ ] **Step 1: Tulis `BootReceiver.kt`**

```kotlin
package com.pakpon.printagent.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.pakpon.printagent.di.ServiceLocator

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        // ServiceLocator may not be initialized yet if Application hasn't run.
        // Application class is loaded before any receiver, so init should be safe.
        if (!ServiceLocator.isInit()) {
            ServiceLocator.init(context.applicationContext)
        }

        val autoStart = ServiceLocator.settingsRepository.isAutoStartOnBoot()
        val loggedIn = ServiceLocator.authRepository.isLoggedIn()
        Log.i("PakPonAgent", "BootReceiver: autoStart=$autoStart, loggedIn=$loggedIn")
        if (autoStart && loggedIn) {
            PrintAgentService.start(context)
        }
    }
}
```

- [ ] **Step 2: Update `ServiceLocator.kt` untuk `isInit()` helper**

Modify `print-agent/app/src/main/kotlin/com/pakpon/printagent/di/ServiceLocator.kt`, ganti method `init` jadi:

```kotlin
fun init(appContext: Context) {
    if (initialized) return
    val supabase = SupabaseClientFactory.get()
    settingsRepository = SettingsRepository(appContext)
    authRepository = AuthRepository(supabase)
    printRepository = PrintRepository(supabase)
    val deviceInfo = "${Build.MANUFACTURER} ${Build.MODEL} (Android ${Build.VERSION.RELEASE})"
    heartbeatRepository = HeartbeatRepository(supabase, settingsRepository, deviceInfo)
    initialized = true
}

fun isInit(): Boolean = initialized
```

- [ ] **Step 3: Commit**

```bash
git add print-agent/app/src/main/kotlin/com/pakpon/printagent/service/BootReceiver.kt \
        print-agent/app/src/main/kotlin/com/pakpon/printagent/di/ServiceLocator.kt
git commit -m "feat(agent): BootReceiver + ServiceLocator.isInit() helper"
```

---

## Task 14: Compose Theme files

**Files:**
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/ui/theme/Color.kt`
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/ui/theme/Theme.kt`
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/ui/theme/Type.kt`

- [ ] **Step 1: Tulis `Color.kt` (match Pak Pon palette dari web)**

```kotlin
package com.pakpon.printagent.ui.theme

import androidx.compose.ui.graphics.Color

// Match web palette dari app/globals.css
val Paper = Color(0xFFFAF7F0)
val PaperSoft = Color(0xFFFEFDF8)
val Cream = Color(0xFFF5EFE0)
val Coal = Color(0xFF1A1411)
val CoalSoft = Color(0xFF4A3F35)
val Clay = Color(0xFF8A7E6E)
val ClaySoft = Color(0xFFC9BEB0)
val ClayMist = Color(0xFFEBE4D6)

val Night = Color(0xFF1B3954)
val NightSoft = Color(0xFF284B6A)
val Ink = Color(0xFFFAF7F0)
val InkSoft = Color(0xFFE3EBF2)

val Brick = Color(0xFFD02D1F)
val BrickSoft = Color(0xFFE64336)
val BrickDark = Color(0xFF9B281F)
val BrickFaint = Color(0xFFFBE6E3)

val Gold = Color(0xFFF5A623)
val GoldFaint = Color(0xFFFBF0D6)
val Leaf = Color(0xFF5C7F3E)
```

- [ ] **Step 2: Tulis `Type.kt`**

```kotlin
package com.pakpon.printagent.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val PakPonTypography = Typography(
    headlineLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 28.sp),
    headlineMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 22.sp),
    titleLarge = TextStyle(fontWeight = FontWeight.Medium, fontSize = 18.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.Medium, fontSize = 16.sp),
    bodyLarge = TextStyle(fontWeight = FontWeight.Normal, fontSize = 16.sp),
    bodyMedium = TextStyle(fontWeight = FontWeight.Normal, fontSize = 14.sp),
    bodySmall = TextStyle(fontWeight = FontWeight.Normal, fontSize = 12.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.Medium, fontSize = 14.sp),
)
```

- [ ] **Step 3: Tulis `Theme.kt`**

```kotlin
package com.pakpon.printagent.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val LightColors = lightColorScheme(
    primary = Night,
    onPrimary = Ink,
    secondary = Gold,
    onSecondary = Coal,
    background = Paper,
    onBackground = Coal,
    surface = PaperSoft,
    onSurface = Coal,
    error = Brick,
    onError = Ink,
)

@Composable
fun PakPonAgentTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LightColors,
        typography = PakPonTypography,
        content = content,
    )
}
```

- [ ] **Step 4: Commit**

```bash
git add print-agent/app/src/main/kotlin/com/pakpon/printagent/ui/theme/
git commit -m "feat(agent): Compose theme matching Pak Pon web palette"
```

---

## Task 15: `LoginScreen` + `LoginViewModel`

**Files:**
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/ui/login/LoginViewModel.kt`
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/ui/login/LoginScreen.kt`

- [ ] **Step 1: Tulis `LoginViewModel.kt`**

```kotlin
package com.pakpon.printagent.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pakpon.printagent.data.auth.AuthRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val loading: Boolean = false,
    val errorMessage: String? = null,
    val success: Boolean = false,
)

class LoginViewModel(
    private val authRepo: AuthRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    fun onEmailChange(value: String) {
        _uiState.update { it.copy(email = value, errorMessage = null) }
    }

    fun onPasswordChange(value: String) {
        _uiState.update { it.copy(password = value, errorMessage = null) }
    }

    fun signIn() {
        val s = _uiState.value
        if (s.email.isBlank() || s.password.isBlank()) {
            _uiState.update { it.copy(errorMessage = "Email & password wajib diisi") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(loading = true, errorMessage = null) }
            try {
                authRepo.signIn(s.email, s.password)
                _uiState.update { it.copy(loading = false, success = true) }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(loading = false, errorMessage = e.message ?: "Login gagal")
                }
            }
        }
    }
}
```

- [ ] **Step 2: Tulis `LoginScreen.kt`**

```kotlin
package com.pakpon.printagent.ui.login

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel

@Composable
fun LoginScreen(
    viewModel: LoginViewModel,
    onLoginSuccess: () -> Unit,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(state.success) {
        if (state.success) onLoginSuccess()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Pak Pon Print Agent", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(32.dp))

        OutlinedTextField(
            value = state.email,
            onValueChange = viewModel::onEmailChange,
            label = { Text("Email") },
            singleLine = true,
            enabled = !state.loading,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))

        OutlinedTextField(
            value = state.password,
            onValueChange = viewModel::onPasswordChange,
            label = { Text("Password") },
            singleLine = true,
            enabled = !state.loading,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )

        if (state.errorMessage != null) {
            Spacer(Modifier.height(8.dp))
            Text(
                state.errorMessage!!,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
            )
        }

        Spacer(Modifier.height(24.dp))

        Button(
            onClick = viewModel::signIn,
            enabled = !state.loading,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (state.loading) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
                Text("Login...")
            } else {
                Text("Login")
            }
        }
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add print-agent/app/src/main/kotlin/com/pakpon/printagent/ui/login/
git commit -m "feat(agent): LoginScreen + LoginViewModel"
```

---

## Task 16: `MainViewModel` (shared state for tabs)

**Files:**
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/ui/main/MainViewModel.kt`

- [ ] **Step 1: Tulis `MainViewModel.kt`**

```kotlin
package com.pakpon.printagent.ui.main

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pakpon.printagent.data.heartbeat.HeartbeatRepository
import com.pakpon.printagent.data.heartbeat.HeartbeatRow
import com.pakpon.printagent.data.print.PrintJob
import com.pakpon.printagent.data.print.PrintRepository
import com.pakpon.printagent.data.print.PrintStatus
import com.pakpon.printagent.data.settings.SettingsRepository
import com.pakpon.printagent.printer.PrinterTcpClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.format.DateTimeFormatter

data class MainUiState(
    val agentLabel: String = "",
    val agents: List<HeartbeatRow> = emptyList(),
    val jobs: List<PrintJob> = emptyList(),
    val historyFilter: HistoryFilter = HistoryFilter.All,
    val loading: Boolean = false,
    val errorMessage: String? = null,
    val dapurIp: String = "",
    val minumanIp: String = "",
    val port: String = "9100",
    val autoStart: Boolean = false,
    val settingsDirty: Boolean = false,
    val testResultDapur: String? = null,
    val testResultMinuman: String? = null,
)

enum class HistoryFilter { All, Today, Failed }

class MainViewModel(
    private val printRepo: PrintRepository,
    private val heartbeatRepo: HeartbeatRepository,
    private val settings: SettingsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MainUiState())
    val uiState: StateFlow<MainUiState> = _uiState.asStateFlow()

    init {
        loadInitial()
    }

    fun loadInitial() {
        _uiState.update {
            it.copy(
                agentLabel = settings.getAgentLabel(),
                dapurIp = settings.getDapurIp() ?: "",
                minumanIp = settings.getMinumanIp() ?: "",
                port = settings.getPort().toString(),
                autoStart = settings.isAutoStartOnBoot(),
            )
        }
        refreshAgentsAndJobs()
    }

    fun refreshAgentsAndJobs() {
        viewModelScope.launch {
            _uiState.update { it.copy(loading = true, errorMessage = null) }
            try {
                val agents = heartbeatRepo.fetchAll()
                val jobs = printRepo.fetchRecent(limit = 50)
                _uiState.update { it.copy(loading = false, agents = agents, jobs = jobs) }
            } catch (e: Exception) {
                _uiState.update { it.copy(loading = false, errorMessage = e.message ?: "load error") }
            }
        }
    }

    fun setHistoryFilter(filter: HistoryFilter) {
        _uiState.update { it.copy(historyFilter = filter) }
    }

    fun retryJob(jobId: String) {
        viewModelScope.launch {
            try {
                printRepo.retry(jobId)
                refreshAgentsAndJobs()
            } catch (e: Exception) {
                _uiState.update { it.copy(errorMessage = "Retry failed: ${e.message}") }
            }
        }
    }

    // — Settings setters —

    fun setAgentLabelInput(value: String) = setDirtyAndUpdate { it.copy(agentLabel = value, settingsDirty = true) }
    fun setDapurIpInput(value: String) = setDirtyAndUpdate { it.copy(dapurIp = value, settingsDirty = true) }
    fun setMinumanIpInput(value: String) = setDirtyAndUpdate { it.copy(minumanIp = value, settingsDirty = true) }
    fun setPortInput(value: String) = setDirtyAndUpdate { it.copy(port = value, settingsDirty = true) }
    fun setAutoStartInput(value: Boolean) = setDirtyAndUpdate { it.copy(autoStart = value, settingsDirty = true) }

    private fun setDirtyAndUpdate(transform: (MainUiState) -> MainUiState) {
        _uiState.update(transform)
    }

    fun saveSettings() {
        val s = _uiState.value
        settings.setAgentLabel(s.agentLabel)
        settings.setDapurIp(s.dapurIp)
        settings.setMinumanIp(s.minumanIp)
        s.port.toIntOrNull()?.let { settings.setPort(it) }
        settings.setAutoStartOnBoot(s.autoStart)
        _uiState.update { it.copy(settingsDirty = false) }
    }

    fun testConnection(target: String) {
        val s = _uiState.value
        val ip = if (target == "dapur") s.dapurIp else s.minumanIp
        val port = s.port.toIntOrNull() ?: SettingsRepository.DEFAULT_PORT
        if (ip.isBlank()) {
            _uiState.update {
                if (target == "dapur") it.copy(testResultDapur = "IP belum diisi")
                else it.copy(testResultMinuman = "IP belum diisi")
            }
            return
        }
        viewModelScope.launch {
            val testBytes = byteArrayOf(0x1B, 0x40) + "TES KONEKSI\n".toByteArray() + byteArrayOf(0x1D, 0x56, 0x00)
            val result = try {
                PrinterTcpClient.send(ip, port, testBytes, connectTimeoutMs = 3000)
                "✓ Berhasil di ${nowHHmm()}"
            } catch (e: Exception) {
                "✗ Gagal: ${e.message ?: "unknown"}"
            }
            _uiState.update {
                if (target == "dapur") it.copy(testResultDapur = result)
                else it.copy(testResultMinuman = result)
            }
        }
    }

    private fun nowHHmm(): String =
        DateTimeFormatter.ofPattern("HH:mm:ss").format(Instant.now().atZone(java.time.ZoneId.systemDefault()))

    fun getFilteredJobs(): List<PrintJob> {
        val s = _uiState.value
        return when (s.historyFilter) {
            HistoryFilter.All -> s.jobs
            HistoryFilter.Failed -> s.jobs.filter { it.status == PrintStatus.failed }
            HistoryFilter.Today -> s.jobs.filter {
                it.created_at.startsWith(Instant.now().toString().substring(0, 10))
            }
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add print-agent/app/src/main/kotlin/com/pakpon/printagent/ui/main/MainViewModel.kt
git commit -m "feat(agent): MainViewModel with state for status, history, settings tabs"
```

---

## Task 17: `MainScreen` (tab scaffold + 3 tab composables)

**Files:**
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/ui/main/MainScreen.kt`

- [ ] **Step 1: Tulis `MainScreen.kt`**

```kotlin
package com.pakpon.printagent.ui.main

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pakpon.printagent.data.print.PrintJob
import com.pakpon.printagent.data.print.PrintStatus
import com.pakpon.printagent.ui.theme.Brick
import com.pakpon.printagent.ui.theme.BrickFaint
import com.pakpon.printagent.ui.theme.Leaf

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(
    viewModel: MainViewModel,
    onLogout: () -> Unit,
    onStopAgent: () -> Unit,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var selectedTab by remember { mutableIntStateOf(0) }
    val tabs = listOf("Status", "History", "Settings")

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Pak Pon Agent") },
                actions = {
                    IconButton(onClick = viewModel::refreshAgentsAndJobs) {
                        Icon(Icons.Default.Refresh, "Refresh")
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            TabRow(selectedTabIndex = selectedTab) {
                tabs.forEachIndexed { index, title ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = { Text(title) },
                    )
                }
            }

            when (selectedTab) {
                0 -> StatusTab(state, onStop = onStopAgent)
                1 -> HistoryTab(state, onRetry = viewModel::retryJob, onFilterChange = viewModel::setHistoryFilter, jobsToShow = viewModel.getFilteredJobs())
                2 -> SettingsTab(state, viewModel = viewModel, onLogout = onLogout)
            }
        }
    }
}

@Composable
private fun StatusTab(state: MainUiState, onStop: () -> Unit) {
    Column(
        modifier = Modifier
            .padding(16.dp)
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Agent: ${state.agentLabel}", style = MaterialTheme.typography.titleMedium)
        state.agents.find { it.agent_label == state.agentLabel }?.let { my ->
            Text("Last heartbeat: ${my.last_seen_at}", style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.height(8.dp))
        Text("Recent activity (5)", fontWeight = FontWeight.SemiBold)
        state.jobs.take(5).forEach { job -> JobRow(job, onRetry = null) }
        Spacer(Modifier.height(16.dp))
        OutlinedButton(onClick = onStop, modifier = Modifier.fillMaxWidth()) {
            Text("Stop Agent")
        }
    }
}

@Composable
private fun HistoryTab(
    state: MainUiState,
    jobsToShow: List<PrintJob>,
    onFilterChange: (HistoryFilter) -> Unit,
    onRetry: (String) -> Unit,
) {
    Column(modifier = Modifier.padding(16.dp).fillMaxSize().verticalScroll(rememberScrollState())) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(
                selected = state.historyFilter == HistoryFilter.All,
                onClick = { onFilterChange(HistoryFilter.All) },
                label = { Text("All") },
            )
            FilterChip(
                selected = state.historyFilter == HistoryFilter.Today,
                onClick = { onFilterChange(HistoryFilter.Today) },
                label = { Text("Today") },
            )
            FilterChip(
                selected = state.historyFilter == HistoryFilter.Failed,
                onClick = { onFilterChange(HistoryFilter.Failed) },
                label = { Text("Failed") },
            )
        }
        Spacer(Modifier.height(12.dp))
        if (jobsToShow.isEmpty()) {
            Text("Tidak ada job.", style = MaterialTheme.typography.bodySmall)
        } else {
            jobsToShow.forEach { job -> JobRow(job, onRetry = onRetry) }
        }
    }
}

@Composable
private fun JobRow(job: PrintJob, onRetry: ((String) -> Unit)?) {
    val statusColor = when (job.status) {
        PrintStatus.done -> Leaf
        PrintStatus.failed -> Brick
        else -> MaterialTheme.colorScheme.onSurface
    }
    Card(modifier = Modifier.padding(vertical = 4.dp).fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Text("${job.target} · ${job.trigger}", style = MaterialTheme.typography.titleSmall)
                Text(job.status.name, color = statusColor, style = MaterialTheme.typography.bodySmall)
            }
            Text(job.created_at, style = MaterialTheme.typography.bodySmall)
            if (job.failure_reason != null) {
                Spacer(Modifier.height(4.dp))
                Text(job.failure_reason, style = MaterialTheme.typography.bodySmall, color = Brick)
                if (onRetry != null) {
                    Spacer(Modifier.height(4.dp))
                    TextButton(onClick = { onRetry(job.id) }) {
                        Text("Retry")
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsTab(state: MainUiState, viewModel: MainViewModel, onLogout: () -> Unit) {
    Column(
        modifier = Modifier.padding(16.dp).fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Agent Identity", fontWeight = FontWeight.SemiBold)
        OutlinedTextField(
            value = state.agentLabel,
            onValueChange = viewModel::setAgentLabelInput,
            label = { Text("Label") },
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(8.dp))
        Text("Printer Dapur", fontWeight = FontWeight.SemiBold)
        OutlinedTextField(
            value = state.dapurIp,
            onValueChange = viewModel::setDapurIpInput,
            label = { Text("IP") },
            placeholder = { Text("192.168.1.50") },
            modifier = Modifier.fillMaxWidth(),
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { viewModel.testConnection("dapur") }) {
                Text("Test koneksi")
            }
            if (state.testResultDapur != null) {
                Text(state.testResultDapur!!, style = MaterialTheme.typography.bodySmall)
            }
        }

        Spacer(Modifier.height(8.dp))
        Text("Printer Minuman", fontWeight = FontWeight.SemiBold)
        OutlinedTextField(
            value = state.minumanIp,
            onValueChange = viewModel::setMinumanIpInput,
            label = { Text("IP") },
            placeholder = { Text("192.168.1.51") },
            modifier = Modifier.fillMaxWidth(),
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { viewModel.testConnection("minuman") }) {
                Text("Test koneksi")
            }
            if (state.testResultMinuman != null) {
                Text(state.testResultMinuman!!, style = MaterialTheme.typography.bodySmall)
            }
        }

        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = state.port,
            onValueChange = viewModel::setPortInput,
            label = { Text("Port") },
            singleLine = true,
            modifier = Modifier.width(150.dp),
        )

        Row(verticalAlignment = Alignment.CenterVertically) {
            Switch(checked = state.autoStart, onCheckedChange = viewModel::setAutoStartInput)
            Spacer(Modifier.width(8.dp))
            Text("Auto-start on boot")
        }

        Spacer(Modifier.height(16.dp))
        Button(
            onClick = viewModel::saveSettings,
            enabled = state.settingsDirty,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Save")
        }

        Spacer(Modifier.height(16.dp))
        OutlinedButton(onClick = onLogout, modifier = Modifier.fillMaxWidth()) {
            Text("Logout")
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add print-agent/app/src/main/kotlin/com/pakpon/printagent/ui/main/MainScreen.kt
git commit -m "feat(agent): MainScreen with 3 tabs (Status, History, Settings)"
```

---

## Task 18: `MainActivity` + `PakPonAgentApplication`

**Files:**
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/PakPonAgentApplication.kt`
- Create: `print-agent/app/src/main/kotlin/com/pakpon/printagent/MainActivity.kt`

- [ ] **Step 1: Tulis `PakPonAgentApplication.kt`**

```kotlin
package com.pakpon.printagent

import android.app.Application
import com.pakpon.printagent.di.ServiceLocator

class PakPonAgentApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        ServiceLocator.init(applicationContext)
    }
}
```

- [ ] **Step 2: Tulis `MainActivity.kt`**

```kotlin
package com.pakpon.printagent

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModel
import com.pakpon.printagent.data.auth.AuthRepository
import com.pakpon.printagent.data.heartbeat.HeartbeatRepository
import com.pakpon.printagent.data.print.PrintRepository
import com.pakpon.printagent.data.settings.SettingsRepository
import com.pakpon.printagent.di.ServiceLocator
import com.pakpon.printagent.service.PrintAgentService
import com.pakpon.printagent.ui.login.LoginScreen
import com.pakpon.printagent.ui.login.LoginViewModel
import com.pakpon.printagent.ui.main.MainScreen
import com.pakpon.printagent.ui.main.MainViewModel
import com.pakpon.printagent.ui.theme.PakPonAgentTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            PakPonAgentTheme {
                AppRoot()
            }
        }
    }
}

@Composable
private fun AppRoot() {
    var loggedIn by remember { mutableStateOf(ServiceLocator.authRepository.isLoggedIn()) }
    val context = androidx.compose.ui.platform.LocalContext.current

    if (!loggedIn) {
        val vm: LoginViewModel = viewModel(factory = LoginVmFactory(ServiceLocator.authRepository))
        LoginScreen(viewModel = vm, onLoginSuccess = {
            loggedIn = true
            PrintAgentService.start(context)
        })
    } else {
        val vm: MainViewModel = viewModel(factory = MainVmFactory(
            ServiceLocator.printRepository,
            ServiceLocator.heartbeatRepository,
            ServiceLocator.settingsRepository,
        ))
        val scope = androidx.compose.runtime.rememberCoroutineScope()
        MainScreen(
            viewModel = vm,
            onLogout = {
                scope.launch {
                    ServiceLocator.authRepository.signOut()
                    PrintAgentService.stop(context)
                    loggedIn = false
                }
            },
            onStopAgent = {
                PrintAgentService.stop(context)
            },
        )
    }
}

private class LoginVmFactory(private val authRepo: AuthRepository) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = LoginViewModel(authRepo) as T
}

private class MainVmFactory(
    private val printRepo: PrintRepository,
    private val heartbeatRepo: HeartbeatRepository,
    private val settings: SettingsRepository,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = MainViewModel(printRepo, heartbeatRepo, settings) as T
}
```

- [ ] **Step 3: Verify compile + build debug APK**

```bash
cd print-agent
./gradlew :app:assembleDebug
```

Expected: BUILD SUCCESSFUL. Output: `app/build/outputs/apk/debug/app-debug.apk`

- [ ] **Step 4: Commit**

```bash
git add print-agent/app/src/main/kotlin/com/pakpon/printagent/PakPonAgentApplication.kt \
        print-agent/app/src/main/kotlin/com/pakpon/printagent/MainActivity.kt
git commit -m "feat(agent): MainActivity + Application class wiring all dependencies"
```

---

## Task 19: Install ke device + manual smoke test

**Files:** none — operational task

- [ ] **Step 1: Connect HP Android via USB**

```bash
adb devices  # verify device shows up (kalau perlu enable USB debugging di HP)
```

- [ ] **Step 2: Install debug APK**

```bash
cd print-agent
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Expected: `Success`

- [ ] **Step 3: Buka app, login dengan akun Supabase Pak Pon**

Expected: LoginScreen → input email/password → tap Login → navigate ke MainScreen Status tab.

Notification "Pak Pon Print Agent · Online" muncul di status bar.

- [ ] **Step 4: Setup printer emulator di PC**

(Spec A udah ada `scripts/printer-emulator.js`. Pakai ini.)

```bash
cd /home/brondol/Downloads/pak-pon
npm run emulator:dapur  # terminal 1
# atau: node scripts/printer-emulator.js 9100 dapur
```

Catat PC LAN IP: `ip addr show | grep "inet "` (mis. `192.168.1.10`)

- [ ] **Step 5: Set agent printer IP**

Di agent app → Settings tab:
- Printer Dapur IP: `192.168.1.10` (PC LAN IP)
- Port: `9100`
- Tap "Test koneksi" → ✓ Berhasil

Verify di terminal printer-emulator: muncul `✓ [dapur] N bytes`.

- [ ] **Step 6: Trigger job dari web**

Buka web app (Pak Pon) di laptop/HP, login, scan dummy nota, klik "Simpan & Cetak".

Expected:
- Web toast "Nota tersimpan, N print job dikirim ke agent"
- Agent menerima notification via Realtime (cek `adb logcat -s PakPonAgent`)
- Agent kirim bytes ke PC emulator → terminal print "✓ N bytes"
- Job status di Supabase dashboard: pending → printing → done

- [ ] **Step 7: Verify heartbeat di web debug page**

Buka `/setup/printer/debug` di web → Agent Status section tampil agent dengan label "Tab-XXXX" Online ✓

- [ ] **Step 8: Test failure case**

Set agent Printer Dapur IP ke salah (mis. `192.168.99.99`). Trigger job dari web.

Expected: status='failed', failure_reason='Connection refused' atau 'Timeout'.

Di Agent History tab: row gagal tampil dengan tombol Retry.

- [ ] **Step 9: (No commit — verification task)**

---

## Task 20: Release build & sign for owner distribution

**Files:** none — build process

- [ ] **Step 1: Generate release keystore (one-time)**

```bash
cd print-agent
keytool -genkey -v -keystore release.keystore \
  -alias pakpon-print-agent -keyalg RSA -keysize 4096 -validity 10950 \
  -storepass YOUR_STRONG_PASSWORD -keypass YOUR_STRONG_PASSWORD \
  -dname "CN=Pak Pon Agent, OU=Dev, O=Pak Pon, L=Surabaya, C=ID"

# BACKUP keystore + password ke password manager segera!
mv release.keystore ~/secure/  # store outside repo
```

- [ ] **Step 2: Update `local.properties` dengan keystore path**

```properties
RELEASE_KEYSTORE_PATH=/home/brondol/secure/release.keystore
RELEASE_KEYSTORE_PASSWORD=YOUR_STRONG_PASSWORD
RELEASE_KEY_ALIAS=pakpon-print-agent
RELEASE_KEY_PASSWORD=YOUR_STRONG_PASSWORD
```

- [ ] **Step 3: Build release APK**

```bash
cd print-agent
./gradlew :app:assembleRelease
```

Expected: `app/build/outputs/apk/release/app-release.apk` (signed)

Verify signing:
```bash
$ANDROID_HOME/build-tools/34.0.0/apksigner verify --verbose app/build/outputs/apk/release/app-release.apk
```

- [ ] **Step 4: Upload ke Google Drive**

1. Buka drive.google.com
2. Upload `app-release.apk` ke folder shared dengan owner
3. Klik Share → copy link

- [ ] **Step 5: Kirim panduan ke owner via WA**

Template message:
```
Halo, link install Print Agent untuk warung:
[GOOGLE_DRIVE_LINK]

Cara install:
1. Buka link di Chrome HP
2. Download APK
3. Saat install: ada warning "Install unknown apps" → ketik di setting Android Chrome → enable
4. Install
5. Buka app "Pak Pon Agent"
6. Login dengan email & password warung
7. Di Settings: isi IP printer dapur (cek di printer/router), port 9100, tap Test koneksi
8. Notification "Pak Pon Print Agent · Online" muncul di status bar — itu tandanya agent jalan

Kalau ada error, screenshot kirim balik ya.
```

- [ ] **Step 6: Verify owner install successful via web debug page**

Buka `/setup/printer/debug` → tunggu owner setup → agent muncul di list dengan label "Tab-XXXX" Online ✓

---

## Final review checklist

- [ ] All 20 tasks complete
- [ ] `./gradlew :app:test` semua pass
- [ ] `./gradlew :app:assembleRelease` build successful
- [ ] Manual smoke test pada device sukses (Task 19)
- [ ] Owner-side install successful (Task 20)
- [ ] Real printer (iWare) tested oleh owner — bytes received correctly
- [ ] Heartbeat visible di web debug page
- [ ] End-to-end: web POST → agent print → status update di web

## Out of scope (deferred, future plan)

- iOS support
- Crash reporting (Sentry)
- Multi-warung config
- Auto-discovery printer via mDNS
- Print job priority queue
- Local DB cache untuk history
- Hostname support (alternative to static IP)
