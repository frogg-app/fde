import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { DAEMON_PERMISSIONS, type DaemonPermission } from "@fde/protocol/messages";
import { ensurePrivateFile, writePrivateFileAtomicSync } from "./private-files.js";

/**
 * Paired principals and their device credentials, persisted under
 * `$PASEO_HOME/principals.json` (mode 0600). The daemon is "claimed" once at
 * least one principal holds a credential; pairing the first device claims it.
 *
 * Credentials are high-entropy random secrets, so they are stored as SHA-256
 * digests and compared in constant time instead of going through bcrypt.
 */
export const PRINCIPALS_FILENAME = "principals.json";

const CredentialRecordSchema = z
  .object({
    id: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: z.string().min(1),
    label: z.string().optional(),
  })
  .strict();

const PrincipalRecordSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    createdAt: z.string().min(1),
    permissions: z.array(z.enum(DAEMON_PERMISSIONS)),
    credentials: z.array(CredentialRecordSchema),
  })
  .strict();

const PrincipalsFileSchema = z
  .object({
    version: z.literal(1),
    claimedAt: z.string().optional(),
    principals: z.array(PrincipalRecordSchema),
  })
  .strict();

export type PrincipalRecord = z.infer<typeof PrincipalRecordSchema>;
export type PrincipalsFile = z.infer<typeof PrincipalsFileSchema>;

export interface MintedPrincipal {
  principalId: string;
  credentialId: string;
  /** Plaintext credential; shown exactly once to the pairing client. */
  credential: string;
  permissions: DaemonPermission[];
}

export interface ClaimStore {
  readonly filePath: string;
  read(): PrincipalsFile;
  isClaimed(): boolean;
  claimedAt(): string | null;
  credentialHashes(): string[];
  mintPrincipal(input: {
    label: string;
    permissions?: readonly DaemonPermission[];
  }): MintedPrincipal;
  reset(): boolean;
}

export function hashCredential(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function emptyPrincipalsFile(): PrincipalsFile {
  return { version: 1, principals: [] };
}

function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

export function createClaimStore(paseoHome: string): ClaimStore {
  const filePath = path.join(paseoHome, PRINCIPALS_FILENAME);
  let cache: { mtimeMs: number; size: number; value: PrincipalsFile } | null = null;

  function read(): PrincipalsFile {
    if (!existsSync(filePath)) {
      cache = null;
      return emptyPrincipalsFile();
    }
    const stat = statSync(filePath);
    if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) {
      return cache.value;
    }
    ensurePrivateFile(filePath);
    const parsed = PrincipalsFileSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
    cache = { mtimeMs: stat.mtimeMs, size: stat.size, value: parsed };
    return parsed;
  }

  function write(value: PrincipalsFile): void {
    writePrivateFileAtomicSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
    cache = null;
  }

  function isClaimed(): boolean {
    return read().principals.some((principal) => principal.credentials.length > 0);
  }

  return {
    filePath,
    read,
    isClaimed,
    claimedAt: () => read().claimedAt ?? null,
    credentialHashes: () =>
      read().principals.flatMap((principal) =>
        principal.credentials.map((credential) => credential.sha256),
      ),
    mintPrincipal: ({ label, permissions }) => {
      const current = read();
      const now = new Date().toISOString();
      const credential = randomBytes(32).toString("base64url");
      const principal: PrincipalRecord = {
        id: generateId("prn"),
        label: label.trim() || "Paired device",
        createdAt: now,
        permissions: [...(permissions ?? DAEMON_PERMISSIONS)],
        credentials: [
          { id: generateId("crd"), sha256: hashCredential(credential), createdAt: now },
        ],
      };
      write({
        version: 1,
        claimedAt: current.claimedAt ?? now,
        principals: [...current.principals, principal],
      });
      return {
        principalId: principal.id,
        credentialId: principal.credentials[0]!.id,
        credential,
        permissions: principal.permissions,
      };
    },
    reset: () => {
      const existed = existsSync(filePath);
      rmSync(filePath, { force: true });
      cache = null;
      return existed;
    },
  };
}
