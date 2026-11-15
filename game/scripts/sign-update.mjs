// OTA 更新清單數位簽章工具（對應 src/ui/update.ts 的 verifyManifestSignature）。
//
// 用法：
//   node scripts/sign-update.mjs --keygen [--out-key <priv.pem>] [--out-pub <pub.b64>]
//   node scripts/sign-update.mjs --sign <manifest.json> --key <priv.pem> [--out <signed.json>]
//   node scripts/sign-update.mjs --verify <manifest.json> --pub <pub.b64>
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 產生與 Web Crypto verifyManifestSignature 相容的 ECDSA P-256 金鑰對（SPKI Base64 公鑰 + PKCS8 PEM 私鑰）。 */
export function generateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return {
    publicKeyB64: Buffer.from(publicKey).toString('base64'),
    privateKeyPem: privateKey,
  };
}

/** 計算與 update.ts verifyManifestSignature 完全一致的正規化待簽字串。 */
export function canonicalManifestString(manifest) {
  if (!manifest || typeof manifest.version !== 'string' || typeof manifest.shell !== 'number' || !manifest.files || typeof manifest.files !== 'object') {
    throw new Error('Invalid manifest structure: expected { version: string, shell: number, files: object }');
  }
  const entries = Object.keys(manifest.files)
    .sort()
    .map(k => `${k}=${manifest.files[k]?.[0] ?? ''}`)
    .join(',');
  return `${manifest.version}:${manifest.shell}:${entries}`;
}

/** 使用 ECDSA P-256 + SHA-256（IEEE P1363 編碼，對應 Web Crypto）為清單產生 Base64 簽章並回傳新清單物件。 */
export function signManifest(manifest, privateKeyPem) {
  const canonical = canonicalManifestString(manifest);
  const key = createPrivateKey(privateKeyPem);
  const sig = cryptoSign('sha256', Buffer.from(canonical, 'utf8'), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  return { ...manifest, sig: sig.toString('base64') };
}

/** 使用 SPKI Base64 公鑰驗證清單簽章。 */
export function verifyManifestWithNode(manifest, publicKeyB64) {
  if (!manifest || typeof manifest.sig !== 'string' || !manifest.sig || !publicKeyB64) return false;
  try {
    const canonical = canonicalManifestString(manifest);
    const spkiDer = Buffer.from(publicKeyB64, 'base64');
    const key = createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
    const sig = Buffer.from(manifest.sig, 'base64');
    return cryptoVerify('sha256', Buffer.from(canonical, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, sig);
  } catch {
    return false;
  }
}

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function printUsage() {
  console.log(`Usage:
  node scripts/sign-update.mjs --keygen [--out-key <priv.pem>] [--out-pub <pub.b64>]
  node scripts/sign-update.mjs --sign <manifest.json> --key <priv.pem> [--out <signed.json>]
  node scripts/sign-update.mjs --verify <manifest.json> --pub <pub.b64>`);
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    return 0;
  }

  if (args.includes('--keygen')) {
    const { publicKeyB64, privateKeyPem } = generateKeyPair();
    const outKey = argValue(args, '--out-key');
    const outPub = argValue(args, '--out-pub');
    if (outKey) {
      writeFileSync(resolve(outKey), privateKeyPem, { encoding: 'utf8', mode: 0o600 });
    }
    if (outPub) {
      writeFileSync(resolve(outPub), `${publicKeyB64}\n`, 'utf8');
    }
    if (!outKey && !outPub) {
      console.log(`PUBLIC_KEY_SPKI_B64=${publicKeyB64}`);
      console.log(privateKeyPem.trimEnd());
    } else {
      console.log(`Generated ECDSA P-256 keypair.${outPub ? ` Public: ${outPub}` : ` Public (SPKI Base64): ${publicKeyB64}`}${outKey ? ` Private: ${outKey}` : ''}`);
    }
    return 0;
  }

  const signPath = argValue(args, '--sign');
  if (signPath !== undefined) {
    const keyPath = argValue(args, '--key');
    if (!keyPath) {
      console.error('Error: --sign requires --key <priv.pem>');
      return 1;
    }
    const manifest = JSON.parse(readFileSync(resolve(signPath), 'utf8'));
    const privPem = readFileSync(resolve(keyPath), 'utf8');
    const signed = signManifest(manifest, privPem);
    const outPath = resolve(argValue(args, '--out') ?? signPath);
    writeFileSync(outPath, `${JSON.stringify(signed, null, 2)}\n`, 'utf8');
    console.log(`Signed ${outPath} (v${signed.version}, ${Object.keys(signed.files).length} files)`);
    return 0;
  }

  const verifyPath = argValue(args, '--verify');
  if (verifyPath !== undefined) {
    const pubArg = argValue(args, '--pub');
    if (!pubArg) {
      console.error('Error: --verify requires --pub <pub.b64>');
      return 1;
    }
    const manifest = JSON.parse(readFileSync(resolve(verifyPath), 'utf8'));
    let pubB64 = pubArg;
    if (pubArg.endsWith('.b64') || pubArg.endsWith('.txt') || pubArg.includes('/') || pubArg.includes('\\')) {
      try {
        pubB64 = readFileSync(resolve(pubArg), 'utf8').trim();
      } catch {
        // Treat as raw base64 string if file does not exist
      }
    }
    const ok = verifyManifestWithNode(manifest, pubB64);
    console.log(ok ? 'Signature VALID' : 'Signature INVALID');
    return ok ? 0 : 1;
  }

  console.error('Error: unknown command. Use --keygen, --sign, or --verify.');
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main(process.argv));
}
