import { createHash, createPublicKey } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [outputPath, distributionFlag] = process.argv.slice(2);
if (!outputPath || !['true', 'false'].includes(distributionFlag)) {
  throw new Error('Expected output path and distribution-build flag.');
}

const catalogUrl = process.env.NOLOADER_RELEASE_CATALOG_URL?.trim() ?? '';
const configuredPem = process.env.NOLOADER_RELEASE_PUBLIC_KEY_PEM?.trim() ?? '';
if (Boolean(catalogUrl) !== Boolean(configuredPem)) {
  throw new Error('Set both NOLOADER_RELEASE_CATALOG_URL and NOLOADER_RELEASE_PUBLIC_KEY_PEM.');
}
if (distributionFlag === 'true' && (!catalogUrl || !configuredPem)) {
  throw new Error('A distribution publish requires the official HTTPS catalog URL and pinned ECDSA public key.');
}

let publicKeyPem = '';
let keyId = '';
if (catalogUrl) {
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
    public static bool IsConfigured => ${Boolean(catalogUrl && publicKeyPem)};
}
`;

const destination = resolve(outputPath);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, source, { encoding: 'utf8' });
