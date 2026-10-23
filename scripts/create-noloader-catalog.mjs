import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { basename } from "node:path";

const version = required("NOLOADER_RELEASE_VERSION");
const tag = required("GITHUB_REF_NAME");
const repository = required("GITHUB_REPOSITORY");
const upstreamCommit = required("NOLOADER_UPSTREAM_COMMIT");
const archivePath = required("NOLOADER_RELEASE_ARCHIVE_PATH");
const outputPath = required("NOLOADER_RELEASE_CATALOG_OUTPUT");
const privateKeyPem = required("NOLOADER_RELEASE_SIGNING_PRIVATE_KEY_PEM");

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error("GITHUB_REPOSITORY is invalid.");
}
if (!/^noloader-v/.test(tag) || tag.slice("noloader-v".length) !== version) {
  throw new Error("The release version does not match the NoLoader tag.");
}
if (!/^[0-9a-f]{40}$/i.test(upstreamCommit)) {
  throw new Error("The upstream commit must be a full Git commit SHA.");
}
if (!isSemVer(version)) throw new Error("NOLOADER_RELEASE_VERSION must be SemVer.");

const privateKey = createPrivateKey(privateKeyPem);
const publicKey = createPublicKey(privateKey);
if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
  throw new Error("The release key must be ECDSA P-256.");
}
const keyId = createHash("sha256")
  .update(publicKey.export({ format: "der", type: "spki" }))
  .digest("hex");

const archiveInfo = await stat(archivePath);
const sha256 = await hashFile(archivePath);
const generatedAtUtc = new Date();
const expiresAtUtc = new Date(generatedAtUtc.getTime() + 29 * 24 * 60 * 60 * 1000);
const archiveName = basename(archivePath);
const archiveUrl = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(archiveName)}`;
const payload = {
  schemaVersion: 1,
  productId: "NoLoader.Launcher",
  generatedAtUtc: generatedAtUtc.toISOString(),
  expiresAtUtc: expiresAtUtc.toISOString(),
  releases: [
    {
      version,
      channel: version.includes("beta") ? "beta" : "stable",
      upstreamCommit,
      coreVersion: "1.0.0",
      apiVersion: "1.0.0",
      platform: "windows",
      architecture: "x64",
      minimumInstallerVersion: "1.0.0",
      launcherExecutable: "noriskclient-launcher-v3.exe",
      archive: {
        format: "zip",
        url: archiveUrl,
        sha256,
        sizeBytes: archiveInfo.size,
      },
    },
  ],
};
const payloadBytes = Buffer.from(JSON.stringify(payload));
const signature = sign("sha256", payloadBytes, {
  key: privateKey,
  dsaEncoding: "ieee-p1363",
});
const envelope = {
  schemaVersion: 1,
  keyId,
  payload: payloadBytes.toString("base64"),
  signature: signature.toString("base64"),
};

await writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
process.stdout.write(`Signed ${version} for ${repository}; catalog key ${keyId}.\n`);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function isSemVer(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value);
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
