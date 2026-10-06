import {
  REDACTION_MARKER,
  type JsonObject,
  type RawRecords,
} from "@domusops/schema";
import { describe, expect, it } from "vitest";
import {
  LOGBOOK_EXEMPT_KEYS,
  redact,
  redactRows,
  TRACE_EXEMPT_KEYS,
} from "../src/snapshot/redact.js";

const TOKEN = "configured-token-abcdef123456";
const M = REDACTION_MARKER;

const records = (partial: Partial<RawRecords> = {}): RawRecords => ({
  config: {},
  states: [],
  entity_registry: [],
  device_registry: [],
  area_registry: [],
  config_entries: [],
  ...partial,
});

/** Redacts one state's attributes and returns them. */
function attrs(attributes: JsonObject): JsonObject {
  const out = redact(
    records({ states: [{ entity_id: "sensor.t", state: "on", attributes }] }),
    TOKEN,
  );
  return out.states[0]?.attributes as JsonObject;
}

describe("K1: credential key names", () => {
  it("replaces the whole value and keeps the field", () => {
    const out = attrs({
      access_token: "a".repeat(30),
      api_key: "b".repeat(30),
      apiKey: "c".repeat(30),
      password: "d".repeat(30),
      client_secret: "e".repeat(30),
      bearer: "f".repeat(30),
      webhook_id: "g".repeat(30),
      credentials: { user: "x", pass: "y" },
      authorization: "h".repeat(30),
      encryption_key: "i".repeat(30),
      auth_key: "j".repeat(30),
      privateKey: "k".repeat(30),
    });
    for (const key of Object.keys(out)) expect(out[key]).toBe(M);
    expect(Object.keys(out)).toHaveLength(12);
  });

  it("accepts false positives such as token_expiry, and leaves ordinary keys alone", () => {
    const out = attrs({
      token_expiry: 3600,
      friendly_name: "Lamp",
      key: "plain",
      keyboard: "us",
    });
    expect(out["token_expiry"]).toBe(M);
    expect(out["friendly_name"]).toBe("Lamp");
    expect(out["key"]).toBe("plain");
    expect(out["keyboard"]).toBe("us");
  });

  it("applies at any depth, including nested options of a registry entry", () => {
    const out = redact(
      records({
        entity_registry: [
          {
            entity_id: "camera.c",
            options: { deep: { api_key: "z".repeat(30) } },
          },
        ],
      }),
      TOKEN,
    );
    expect(out.entity_registry[0]?.["options"]).toEqual({
      deep: { api_key: M },
    });
  });
});

describe("V1: URL query credentials", () => {
  it("replaces only the secret parameter values and keeps the path", () => {
    const out = attrs({
      a: "/api/camera_proxy/camera.x?token=abc123XYZ&width=640",
      b: "https://h/p?sig=SIGVALUE1&x=1&key=KEYVALUE2&auth=AUTHVALUE3&signature=SIGNVALUE4",
    });
    expect(out["a"]).toBe(`/api/camera_proxy/camera.x?token=${M}&width=640`);
    expect(out["b"]).toBe(
      `https://h/p?sig=${M}&x=1&key=${M}&auth=${M}&signature=${M}`,
    );
  });
});

describe("V2: URL user info", () => {
  it("replaces the password, not the user or host", () => {
    const out = attrs({
      url: "https://admin:Sup3rS3cretPw@192.168.1.50:8080/path",
    });
    expect(out["url"]).toBe(`https://admin:${M}@192.168.1.50:8080/path`);
  });
});

describe("V3 and V4: JWT and Bearer", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  it("replaces a JWT inside a larger string", () => {
    expect(attrs({ note: `see ${jwt} end` })["note"]).toBe(`see ${M} end`);
  });
  it("replaces the credential after Bearer, case-insensitively", () => {
    expect(attrs({ h: "sent with Bearer abc.DEF-123_456~+/= ok" })["h"]).toBe(
      `sent with Bearer ${M} ok`,
    );
    expect(attrs({ h: "bearer lowercase-credential-99" })["h"]).toBe(
      `bearer ${M}`,
    );
  });
});

describe("V5: the configured token", () => {
  it("replaces any exact occurrence", () => {
    expect(attrs({ note: `prefix ${TOKEN} suffix` })["note"]).toBe(
      `prefix ${M} suffix`,
    );
  });
});

describe("V6: e-mail addresses", () => {
  it("replaces addresses in attributes, states, and config entry titles", () => {
    const out = redact(
      records({
        states: [
          {
            entity_id: "sensor.t",
            state: "jane.doe@example-mail.com",
            attributes: { n: "mail a.b+c@ex-ample.co.uk!" },
          },
        ],
        config_entries: [
          {
            entry_id: "E1",
            domain: "nest",
            title: "Nest (jane.doe@example-mail.com)",
          },
        ],
      }),
      TOKEN,
    );
    expect(out.states[0]?.state).toBe(M);
    expect(out.states[0]?.attributes?.["n"]).toBe(`mail ${M}!`);
    expect(out.config_entries[0]?.title).toBe(`Nest (${M})`);
  });

  it("does not turn the user part of a URL into an e-mail match", () => {
    expect(
      attrs({ url: "https://user:pw123456789@host.example.com/" })["url"],
    ).toBe(`https://user:${M}@host.example.com/`);
  });
});

describe("C1: coordinates", () => {
  it("replaces coordinate keys at any depth and of any type", () => {
    const out = redact(
      records({
        config: {
          latitude: 41.385064,
          longitude: 2.173404,
          elevation: 731.25,
          radius: 100,
        },
        states: [
          {
            entity_id: "zone.z",
            state: "0",
            attributes: {
              lat: 1.5,
              lon: 2.5,
              lng: 3.5,
              nested: { latitude: "48.85" },
            },
          },
        ],
      }),
      TOKEN,
    );
    expect(out.config).toEqual({
      latitude: M,
      longitude: M,
      elevation: M,
      radius: 100,
    });
    expect(out.states[0]?.attributes).toEqual({
      lat: M,
      lon: M,
      lng: M,
      nested: { latitude: M },
    });
  });

  it("replaces a numeric pair under gps or location, and nothing else", () => {
    const out = attrs({
      gps: [35.689487, 139.691711],
      location: "35.689487,139.691711",
      place: [1, 2],
    });
    expect(out["gps"]).toBe(M);
    expect(out["location"]).toBe(M);
    expect(out["place"]).toEqual([1, 2]);
    const other = attrs({ gps: [1, 2, 3], location: "Kitchen" });
    expect(other["gps"]).toEqual([1, 2, 3]);
    expect(other["location"]).toBe("Kitchen");
  });
});

describe("C2: coordinate pairs written as text", () => {
  const text = (value: string): unknown => attrs({ note: value })["note"];

  it("redacts a pair of decimals with at least three decimals each", () => {
    expect(text("arrived at 41.3851, 2.1734")).toBe(`arrived at ${M}`);
    expect(text("at 41.3851 2.1734 today")).toBe(`at ${M} today`);
    expect(text("-33.868820,151.209290")).toBe(M);
    expect(text("(41.385064, -103.4425)")).toBe(`(${M})`);
  });

  it("leaves a pair alone when it cannot be a latitude and a longitude", () => {
    expect(text("95.1234, 2.1734")).toBe("95.1234, 2.1734");
    expect(text("41.3851, 181.2345")).toBe("41.3851, 181.2345");
  });

  it("leaves numbers with fewer than three decimals alone", () => {
    expect(text("21.5, 22.0")).toBe("21.5, 22.0");
    expect(text("temperatures 21.50 and 22.75")).toBe(
      "temperatures 21.50 and 22.75",
    );
  });

  it("does not start in the middle of a longer number", () => {
    expect(text("1789452345.123456 1789452345.234567")).toBe(
      "1789452345.123456 1789452345.234567",
    );
  });

  it("does not end in the middle of a dotted version, but still ends at a full stop", () => {
    expect(text("time 12.345 67.890.1")).toBe("time 12.345 67.890.1");
    expect(text("arrived at 41.3851, 2.1734.")).toBe(`arrived at ${M}.`);
  });
});

describe("C3: the instance's own coordinates", () => {
  const withConfig = (
    latitude: unknown,
    longitude: unknown,
    note: string,
  ): unknown => {
    const out = redact(
      records({
        config: { latitude, longitude },
        states: [{ entity_id: "sensor.t", state: "on", attributes: { note } }],
      }),
      TOKEN,
    );
    return out.states[0]?.attributes?.["note"];
  };

  it("redacts the configured latitude and longitude wherever they occur in text", () => {
    expect(
      withConfig(41.385064, 2.173404, "home is 41.385064 by 2.173404"),
    ).toBe(`home is ${M} by ${M}`);
  });

  it("redacts a signed value and its unsigned form", () => {
    expect(withConfig(20.4746, -103.4425, "at -103.4425 or 103.4425")).toBe(
      `at ${M} or ${M}`,
    );
  });

  it("does not start or end in the middle of a longer number", () => {
    // 20.4746 inside 120.4746, -1103.4425, and 20.47461 is a different number: left intact.
    expect(withConfig(20.4746, -103.4425, "a 120.4746 b")).toBe("a 120.4746 b");
    expect(withConfig(20.4746, -103.4425, "a -1103.4425 b")).toBe(
      "a -1103.4425 b",
    );
    expect(withConfig(20.4746, -103.4425, "a 20.47461 b")).toBe("a 20.47461 b");
    expect(withConfig(20.4746, -103.4425, "a 20.4746. b")).toBe(`a ${M}. b`);
  });

  it("skips a configured value written with fewer than three decimals", () => {
    expect(withConfig(20.4, 3, "level 20.4 and 3")).toBe("level 20.4 and 3");
  });

  it("does nothing when the config has no coordinates", () => {
    expect(withConfig(undefined, undefined, "level 20.4746")).toBe(
      "level 20.4746",
    );
  });
});

describe("redactRows (feature 002)", () => {
  it("applies C3 to rows through the coordinates option", () => {
    const [row] = redactRows([{ when: 1, message: "at 41.385064 now" }], {
      token: "",
      exemptKeys: LOGBOOK_EXEMPT_KEYS,
      coordinates: { latitude: 41.385064, longitude: 2.173404 },
    });
    expect(row?.["message"]).toBe(`at ${M} now`);
  });

  it("does not touch a row that has nothing to redact", () => {
    const input = { when: 1, entity_id: "light.a", state: "on" };
    const [row] = redactRows([input], {
      token: "",
      exemptKeys: LOGBOOK_EXEMPT_KEYS,
    });
    expect(row).toEqual(input);
  });
});

describe("closed exemption list (data-model §8)", () => {
  const jwtShaped =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const email = "someone@example-mail.com";

  it("never redacts the value of an exempt key, even when it looks like a secret", () => {
    const out = redact(
      records({
        states: [
          {
            entity_id: `sensor.${email}`,
            state: "on",
            attributes: {
              entity_id: [jwtShaped, email],
              device_id: jwtShaped,
              area_id: email,
            },
          },
        ],
        entity_registry: [
          {
            entity_id: `sensor.password_token_${email}`,
            config_entry_id: jwtShaped,
            device_id: jwtShaped,
            area_id: email,
            config_subentry_id: email,
          },
        ],
        device_registry: [
          {
            id: jwtShaped,
            via_device_id: email,
            parent_device_id: email,
            area_id: email,
            config_entries: [jwtShaped],
            primary_config_entry: jwtShaped,
          },
        ],
        area_registry: [
          {
            area_id: email,
            floor_id: email,
            humidity_entity_id: email,
            temperature_entity_id: email,
          },
        ],
        config_entries: [{ entry_id: jwtShaped, domain: "x", title: "T" }],
      }),
      TOKEN,
    );
    expect(out.states[0]?.entity_id).toBe(`sensor.${email}`);
    expect(out.states[0]?.attributes).toEqual({
      entity_id: [jwtShaped, email],
      device_id: jwtShaped,
      area_id: email,
    });
    expect(out.entity_registry[0]).toMatchObject({
      config_entry_id: jwtShaped,
      device_id: jwtShaped,
      area_id: email,
    });
    expect(out.device_registry[0]).toMatchObject({
      id: jwtShaped,
      via_device_id: email,
      config_entries: [jwtShaped],
    });
    expect(out.area_registry[0]).toMatchObject({
      area_id: email,
      floor_id: email,
      humidity_entity_id: email,
    });
    expect(out.config_entries[0]?.entry_id).toBe(jwtShaped);
  });

  it("does not exempt the same key names elsewhere by prefix, only the listed keys", () => {
    const out = attrs({ other_entity_id: email, id: email });
    expect(out["other_entity_id"]).toBe(M);
    expect(out["id"]).toBe(M);
  });
});

describe("redact", () => {
  it("returns a deep copy and never mutates its input", () => {
    const input = records({
      states: [
        {
          entity_id: "sensor.t",
          state: "on",
          attributes: { access_token: "x".repeat(30) },
        },
      ],
    });
    const snapshot = JSON.stringify(input);
    const out = redact(input, TOKEN);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out).not.toBe(input);
    expect(out.states[0]).not.toBe(input.states[0]);
  });

  it("leaves an empty configured token out of the matching", () => {
    expect(attrs({ note: "nothing to hide" })["note"]).toBe("nothing to hide");
    const out = redact(
      records({
        states: [
          { entity_id: "sensor.t", state: "on", attributes: { n: "abc" } },
        ],
      }),
      "",
    );
    expect(out.states[0]?.attributes?.["n"]).toBe("abc");
  });
});

describe("redactRows with the trace exempt keys (feature 003)", () => {
  const HEX = "0f3c9a2b7d1e4c5f8a6b9c0d1e2f3a4b";
  const run = (input: JsonObject): JsonObject =>
    redactRows([input], {
      token: TOKEN,
      exemptKeys: TRACE_EXEMPT_KEYS,
    })[0] as JsonObject;

  it("keeps run, device, and config entry IDs and step positions", () => {
    const out = run({
      run_id: HEX,
      last_step: "action/1/choose/0",
      trace: { "action/1/choose/0": [{ path: "action/1/choose/0" }] },
      config: {
        triggers: [{ trigger: "device", device_id: HEX }],
        actions: [{ data: { config_entry_id: HEX } }],
      },
      context: { id: HEX, parent_id: HEX, user_id: HEX },
    });
    expect(JSON.stringify(out)).not.toContain(M);
  });

  it("still redacts credential-named keys and secrets inside text", () => {
    const out = run({
      token: HEX,
      text: "see https://example.test/hook?token=abc123def456",
    }) as Record<string, unknown>;
    expect(out["token"]).toBe(M);
    expect(out["text"]).toBe(`see https://example.test/hook?token=${M}`);
  });

  describe("scanExempt", () => {
    // In a trace, `id`, `path`, and `domain` are also names a user gives to variables.
    const variables = {
      changed_variables: {
        trigger: {
          json: { id: "alice@example.com" },
          path: "/api?token=abc123secret",
          x: { id: { password: "hunter2", email: "bob@example.com" } },
        },
      },
    };
    const scan = (input: JsonObject): string =>
      JSON.stringify(
        redactRows([input], {
          token: TOKEN,
          exemptKeys: TRACE_EXEMPT_KEYS,
          scanExempt: true,
        })[0],
      );

    it("redacts secrets in the value of an exempt key, and inside objects under one", () => {
      const out = scan(variables);
      for (const secret of [
        "alice@example.com",
        "abc123secret",
        "hunter2",
        "bob@example.com",
      ])
        expect(out).not.toContain(secret);
      expect(out).toContain("/api?token=" + M);
    });

    it("keeps the exemption from the key-name rules, so identifiers survive", () => {
      const out = redactRows(
        [
          {
            id: HEX,
            user_id: HEX,
            path: "action/1/choose/0",
            domain: "automation",
            entity_id: "light.kitchen_main",
            device_id: HEX,
            config_entries: [HEX],
          },
        ],
        { token: TOKEN, exemptKeys: TRACE_EXEMPT_KEYS, scanExempt: true },
      )[0];
      expect(JSON.stringify(out)).not.toContain(M);
    });

    it("is off by default: a plain exempt key is still skipped whole", () => {
      const out = redactRows([variables], {
        token: TOKEN,
        exemptKeys: TRACE_EXEMPT_KEYS,
      });
      expect(JSON.stringify(out)).toContain("alice@example.com");
    });
  });
});
