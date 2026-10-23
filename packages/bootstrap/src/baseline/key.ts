import {
  defaultKeyFilePath,
  keygen,
  publicKeyOf,
  resolveIdentity,
} from "../env/age.js";

/** Resolves the user's own age identity, or creates one at the default location (spec FR-011). */
export interface KeyResolution {
  publicKey: string;
  created: boolean;
  path: string;
}

export function resolveOrCreateKey(): KeyResolution {
  const existing = lookupKey();
  if (existing !== null) return existing;
  const path = defaultKeyFilePath();
  return { publicKey: keygen(path), created: true, path };
}

/** The user's own age identity if there is one, without creating anything (used in a preview). */
export function lookupKey(): KeyResolution | null {
  const identity = resolveIdentity();
  if (identity === null) return null;
  return {
    publicKey: publicKeyOf(identity),
    created: false,
    path: identity.path ?? defaultKeyFilePath(),
  };
}
