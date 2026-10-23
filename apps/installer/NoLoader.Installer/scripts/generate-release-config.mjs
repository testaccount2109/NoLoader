import { createHash, createPublicKey } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [outputPath, distributionFlag] = process.argv.slice(2);
if (!outputPath || !['true', 'false'].includes(distributionFlag)) {
  throw new Error('Expected output path and distribution-build flag.');
}

const repository = process.env.NOLOADER_RELEASE_REPOSITORY?.trim() || 'testaccount2109/noriskclient-launcher';
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error('NOLOADER_RELEASE_REPOSITORY must use the owner/repository format.');
}
const catalogUrl = process.env.NOLOADER_RELEASE_CATALOG_URL?.trim()
  || `https://raw.githubusercontent.com/${repository}/noloader-catalog/catalog.json`;
const keyPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../release-public-key.pem');
const configuredPem = process.env.NOLOADER_RELEASE_PUBLIC_KEY_PEM?.trim() || await readFile(keyPath, 'utf8');

let publicKeyPem = '';
let keyId = '';
{
  const url = new URL(catalogUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('NOLOADER_RELEASE_CATALOG_URL must be an absolute HTTPS URL without credentials or a fragment.');
  }
  const key = createPublicKey(configuredPem);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('NOLOADER_RELEASE_PUBLIC_KEY_PEM must be an ECDSA P-256 public key.');
  }
  const der = key.export({ format: 'der', type: 'spki' });
  publicKeyPem = key.export({ format: 'pem', type: 'spki' }).toString();
  keyId = createHash('sha256').update(der).digest('hex');
}

const csharpString = (value) => JSON.stringify(value);
const source = `namespace NoLoader.Installer;

internal static class NoLoaderReleaseConfiguration
{
    public const string CatalogUrl = ${csharpString(catalogUrl)};
    public const string PublicKeyPem = ${csharpString(publicKeyPem)};
    public const string KeyId = ${csharpString(keyId)};
    public static bool IsConfigured => true;
}
`;

const destination = resolve(outputPath);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, source, { encoding: 'utf8' });
