import {
  REDACTION_MARKER,
  type JsonObject,
  type RawRecords,
} from "@domusops/schema";
import { describe, expect, it } from "vitest";
import { redact } from "../src/snapshot/redact.js";

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
