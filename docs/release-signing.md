# Release Signing & BYOA Asset Pack Guide

This document covers:
1. **OTA Update Manifest Signing (ECDSA P-256)** via `game/scripts/sign-update.mjs`
2. **Android Release Keystore Setup for CI/CD** (`.github/workflows/release.yml`)
3. **BYOA (Bring Your Own Assets) `.tar` Pack Structure & Validation** (`game/src/ui/byoa.ts`)

---

## 1. OTA Update Manifest Signing (ECDSA P-256)

In-game OTA updates (`game/src/ui/update.ts`) verify each remote version manifest (`m/<version>.json`) with `verifyManifestSignature(manifest, pubKeyB64)` using Web Crypto ECDSA P-256 + SHA-256 (`IEEE P1363` signature encoding).

### 1.1 Generate an ECDSA P-256 Keypair

Run `game/scripts/sign-update.mjs --keygen`:

```bash
cd game
node scripts/sign-update.mjs --keygen --out-key ota-private.pem --out-pub ota-public.b64
```

- `ota-public.b64`: SPKI DER public key encoded as Base64. Paste this string into `MANIFEST_PUBLIC_KEY` in `game/src/ui/update.ts` before building a release.
- `ota-private.pem`: PKCS#8 PEM private key. **Never commit this file to Git**; store it in your password manager / offline signing environment or CI secret.

> When `MANIFEST_PUBLIC_KEY` is `''` (empty), `verifyManifestSignature` only validates the manifest JSON structure. Once a public key is configured, all OTA manifests must carry a valid `sig` field.

### 1.2 Sign a Release Manifest

Generate the build manifest (`game/scripts/update-manifest.mjs`) and sign it with `sign-update.mjs`:

```bash
cd game
node scripts/update-manifest.mjs dist
node scripts/sign-update.mjs --sign dist/update-base.json --key /path/to/ota-private.pem
```

You can also sign a versioned manifest before publishing to the update server and verify it:

```bash
node scripts/sign-update.mjs --sign m/1.0.1.json --key /path/to/ota-private.pem
node scripts/sign-update.mjs --verify m/1.0.1.json --pub /path/to/ota-public.b64
```

### 1.3 Canonical String Format

Both `sign-update.mjs` and `verifyManifestSignature` (`game/src/ui/update.ts`) compute the exact same canonical string:

```text
<version>:<shell>:<sorted_path_1>=<hash_1>,<sorted_path_2>=<hash_2>,...
```

- Keys in `manifest.files` are sorted lexicographically (`Object.keys(m.files).sort()`).
- Each entry maps `<path>=<sha256_32hex>` (first element of `[hash, size]`).
- Signed with ECDSA P-256 + SHA-256 (`dsaEncoding: 'ieee-p1363'`), stored as Base64 in `manifest.sig`.

---

## 2. Android Release Keystore Setup for CI/CD

The GitHub Actions workflow `.github/workflows/release.yml` builds an unsigned Android release APK and signs it when the `ANDROID_KEYSTORE_BASE64` secret is configured.

### 2.1 Create the Release Keystore

Generate a PKCS12/JKS keystore locally using `keytool` (JDK 21):

```bash
keytool -genkeypair -v \
  -keystore rich4-release.keystore \
  -alias rich4 \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Keep `rich4-release.keystore` and its passwords backed up offline. Losing the keystore prevents publishing updates to an existing Android installation with the same application ID.

### 2.2 Configure GitHub Actions Secrets

Encode the keystore to single-line Base64:

```bash
# macOS
base64 -i rich4-release.keystore | tr -d '\n' | pbcopy

# Linux
base64 -w 0 rich4-release.keystore
```

Add the following four repository secrets in **Settings → Secrets and variables → Actions**:

| Secret Name | Description |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded contents of `rich4-release.keystore` |
| `ANDROID_KEYSTORE_PASS` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias (e.g. `rich4`) |
| `ANDROID_KEY_PASS` | Key password |

### 2.3 CI Signing Flow

When `ANDROID_KEYSTORE_BASE64` is non-empty, `.github/workflows/release.yml`:
1. Decodes `ANDROID_KEYSTORE_BASE64` to `/tmp/release.keystore`.
2. Runs `./gradlew assembleRelease -q` in `game/android`.
3. Aligns the APK with `zipalign -p -f 4`.
4. Signs with `apksigner sign` into `game/release/rich4-${APP_VERSION}-release.apk`.
5. Removes temporary keystore and unaligned APK files.

---

## 3. BYOA (Bring Your Own Assets) `.tar` Pack Structure

Rich4 commercial game assets (original sprites, HD redraws, audio, maps) are excluded from the GPL-3.0-or-later repository. Players supply their own `rich4-assets.tar` pack.

### 3.1 Expected `.tar` Layout

`rich4-assets.tar` uses standard USTAR/POSIX TAR format with top-level `assets/` entries:

```text
assets/
├── maps/
│   ├── maps.json              # Required: map catalog
│   ├── map-0.json / map-0.png
│   └── remake/                # Optional remake maps & DLC packs
├── orig/
│   ├── manifest.json          # Required: original sprite manifest
│   └── ...
├── hd/
│   ├── manifest-hd.json       # Required: HD redraw manifest
│   └── ...
├── audio/                     # Music and SFX
└── ground/                    # 2304×2304 ground textures
```

Verify integrity before unpacking locally:

```bash
shasum -a 256 -c game/rich4-assets.tar.sha256
mkdir -p game/public && tar -xf game/rich4-assets.tar -C game/public
```

### 3.2 Client-Side Validation (`game/src/ui/byoa.ts`)

`validateAssetTar(bytes)` validates an in-memory `Uint8Array` `.tar` pack without bundling any commercial assets:
- Verifies 512-byte USTAR/POSIX TAR header checksums and archive boundaries (rejecting truncated or corrupted archives).
- Normalizes `./` prefixes and rejects path traversal (`..`) or absolute paths (`/`).
- Verifies that required manifest paths (`assets/maps/maps.json`, `assets/orig/manifest.json`, `assets/hd/manifest-hd.json`) exist as regular files.
- Provides `extractTarFile` and `readTarJson` for zero-copy reading of validated pack entries.
