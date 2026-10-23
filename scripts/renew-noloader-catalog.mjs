import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [catalogPath, publicKeyPath] = process.argv.slice(2);
if (!catalogPath || !publicKeyPath) throw new Error("Pass the catalog path and pinned public-key path.");
const privateKeyPem = process.env.NOLOADER_RELEASE_SIGNING_PRIVATE_KEY_PEM?.trim();
if (!privateKeyPem) throw new Error("NOLOADER_RELEASE_SIGNING_PRIVATE_KEY_PEM is required.");

const privateKey = createPrivateKey(privateKeyPem);
const derivedPublicKey = createPublicKey(privateKey);
const pinnedPublicKey = createPublicKey(await readFile(publicKeyPath, "utf8"));
const keyIdOf = (key) => createHash("sha256").update(key.export({ format: "der", type: "spki" })).digest("hex");
const expectedKeyId = keyIdOf(pinnedPublicKey);
if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1" || keyIdOf(derivedPublicKey) !== expectedKeyId) {
  throw new Error("The private key does not match the pinned ECDSA P-256 public key.");
}

const envelope = JSON.parse(await readFile(catalogPath, "utf8"));
if (envelope.schemaVersion !== 1 || envelope.keyId !== expectedKeyId || typeof envelope.payload !== "string" || typeof envelope.signature !== "string") {
  throw new Error("The catalog envelope does not match the pinned signing key.");
}
const payloadBytes = Buffer.from(envelope.payload, "base64");
const signature = Buffer.from(envelope.signature, "base64");
if (signature.length !== 64 || !verify("sha256", payloadBytes, { key: pinnedPublicKey, dsaEncoding: "ieee-p1363" }, signature)) {
  throw new Error("The current catalog signature is invalid.");
}

const payload = JSON.parse(payloadBytes.toString("utf8"));
if (payload.schemaVersion !== 1 || payload.productId !== "NoLoader.Launcher" || !Array.isArray(payload.releases) || payload.releases.length === 0) {
  throw new Error("The current catalog payload is not a supported NoLoader release catalog.");
}
for (const release of payload.releases) {
  if (!release.archive || new URL(release.archive.url).protocol !== "https:" || !/^[0-9a-f]{64}$/i.test(release.archive.sha256)) {
    throw new Error("The current catalog contains an invalid release archive reference.");
  }
}

const generatedAtUtc = new Date();
payload.generatedAtUtc = generatedAtUtc.toISOString();
payload.expiresAtUtc = new Date(generatedAtUtc.getTime() + 29 * 24 * 60 * 60 * 1000).toISOString();
const renewedPayload = Buffer.from(JSON.stringify(payload));
const renewedSignature = sign("sha256", renewedPayload, {
  key: privateKey,
  dsaEncoding: "ieee-p1363",
});
const renewedEnvelope = {
  schemaVersion: 1,
  keyId: expectedKeyId,
  payload: renewedPayload.toString("base64"),
  signature: renewedSignature.toString("base64"),
};
await writeFile(catalogPath, `${JSON.stringify(renewedEnvelope, null, 2)}\n`, "utf8");
process.stdout.write(`Renewed signed catalog with ${payload.releases.length} release(s).\n`);
