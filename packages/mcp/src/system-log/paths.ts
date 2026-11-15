/**
 * The three roots of an installation's paths, replaced by fixed markers so that no absolute path
 * of the host reaches the response (specs/012-ha-system-log FR-009, research R7). On a core or
 * virtual environment installation they lie under the home directory of the host's user.
 */

export const CONFIG_ROOT = "{config}/";
export const HA_ROOT = "{ha}/";
export const PYTHON_ROOT = "{python}/";

/** A path starts the text or follows a space, a quote, a bracket, or a separator. */
const START = String.raw`(?<=^|[\s"'(\[<,=:])`;

/**
 * Up to and including the last `/homeassistant/` segment: the package directory. A segment with a
 * Python library directory after it is not the package but a directory above it, such as a core
 * installation's virtual environment at `/srv/homeassistant`.
 */
const HA_PACKAGE = new RegExp(
  String.raw`${START}/(?:[^\s"'/]+/)*homeassistant/(?![^\s"']*?lib/python\d+\.\d+/)`,
  "g",
);

/** Up to and including `/lib/python<major>.<minor>/`: the standard library and site-packages. */
const PYTHON_LIBRARY = new RegExp(
  String.raw`${START}/(?:[^\s"'/]+/)*?lib/python\d+\.\d+/`,
  "g",
);

const escape = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Returns a function that replaces, in a path or in free text, each absolute path's root with its
 * marker, the first that applies: the configuration directory, then the installation's
 * `homeassistant` package, then the Python library directory. Relative paths, `<template>` and
 * absolute paths outside the three roots are left as they are.
 */
export function rootPaths(configDir: string): (text: string) => string {
  const trimmed = configDir.replace(/\/+$/, "");
  const config =
    trimmed === "" ? null : new RegExp(`${START}${escape(trimmed)}/`, "g");
  return (text) => {
    let out = config === null ? text : text.replace(config, CONFIG_ROOT);
    out = out.replace(HA_PACKAGE, HA_ROOT);
    return out.replace(PYTHON_LIBRARY, PYTHON_ROOT);
  };
}
