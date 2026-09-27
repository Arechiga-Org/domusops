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
  const identity = resolveIdentity();
  if (identity !== null) {
    return {
      publicKey: publicKeyOf(identity),
      created: false,
      path: identity.path ?? defaultKeyFilePath(),
    };
  }
  const path = defaultKeyFilePath();
  return { publicKey: keygen(path), created: true, path };
}
