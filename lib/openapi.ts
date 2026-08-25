import { PRODUCT, PRODUCT_TAGLINE } from "./brand.ts";
import { TOKEN_TTL_SECONDS } from "../core/oauth.ts";
import { EXPORT_COLUMNS } from "../core/export.ts";
import { CHANNELS } from "../core/channel.ts";
import { MARKETS } from "../core/markets.ts";

/**
 * The OpenAPI description, built from the SAME constants the API enforces.
 *
 * Hand-written API docs drift, and a drifted spec is worse than none: a bot
 * generated from it fails in ways that look like server bugs. So the channel
 * list, the market list, the export columns and the token lifetime are all
 * imported rather than retyped — change the code and the document follows.
 */
export function openApiDocument(serverUrl: string) {
  const channels = CHANNELS.map((c) => c.id);
  const markets = Object.keys(MARKETS);

  return {
    openapi: "3.1.0",
    info: {
      title: `${PRODUCT} API`,
      version: "1.0.0",
      summary: PRODUCT_TAGLINE,
      description: [
        "Trade-in and market price intelligence for the United States, the UAE and India.",
        "",
        "**Authentication.** Machines use the OAuth 2.0 client-credentials grant: exchange a",
        "client id and secret at `/api/oauth/token` for an access token valid for",
        `${TOKEN_TTL_SECONDS / 60} minutes, then send it as \`Authorization: Bearer …\`.`,
        "Static keys (`pk_live_…`) are also accepted on the same header.",
        "",
        "**Scopes.** `read` and `write` are granted separately — write does not imply read.",
        "",
        "**Currencies.** Prices are returned in their own currency. Exports carry a USD",
        "column alongside, with the rate used and the date it applied, so a figure can be",
        "reproduced months later.",
      ].join("\n"),
    },
    servers: [{ url: serverUrl }],
    tags: [
      { name: "auth", description: "Obtaining an access token" },
      { name: "prices", description: "Reading and recording prices" },
      { name: "devices", description: "The canonical device catalogue" },
      { name: "rates", description: "Exchange rates and their provenance" },
      { name: "export", description: "Bulk extraction in both currencies" },
    ],
    components: {
      securitySchemes: {
        oauth2: {
          type: "oauth2",
          description: "Client credentials. The token endpoint accepts HTTP Basic or form fields.",
          flows: {
            clientCredentials: {
              tokenUrl: `${serverUrl}/api/oauth/token`,
              scopes: { read: "Read prices, devices and rates", write: "Record prices and rates" },
            },
          },
        },
        bearerToken: { type: "http", scheme: "bearer", description: "An access token, or a pk_live_ key." },
      },
      schemas: {
        Error: {
          type: "object",
          properties: { error: { type: "string" } },
          required: ["error"],
        },
        OAuthError: {
          type: "object",
          description: "RFC 6749 §5.2",
          properties: {
            error: { type: "string", enum: ["invalid_client", "invalid_scope", "unsupported_grant_type", "server_error"] },
            error_description: { type: "string" },
          },
          required: ["error"],
        },
        Token: {
          type: "object",
          properties: {
            access_token: { type: "string" },
            token_type: { type: "string", enum: ["Bearer"] },
            expires_in: { type: "integer", example: TOKEN_TTL_SECONDS },
            scope: { type: "string", example: "read write" },
          },
          required: ["access_token", "token_type", "expires_in"],
        },
        Device: {
          type: "object",
          properties: {
            id: { type: "string", example: "apple-iphone-11-pro-max-4-512" },
            brand: { type: "string", example: "Apple" },
            model: { type: "string", example: "iPhone 11 Pro Max" },
            storageGb: { type: "integer", example: 512 },
            ramGb: {
              type: ["integer", "null"],
              description: "Present where RAM is part of the device's identity — many Indian listings price on it.",
              example: 4,
            },
            sku: { type: "string", example: "4GB / 512GB" },
            label: { type: "string", example: "Apple iPhone 11 Pro Max 4GB / 512GB" },
          },
        },
        MarketPriceInput: {
          type: "object",
          description: "What a device SELLS for — the other half of every spread.",
          properties: {
            deviceId: { type: "string" },
            market: { type: "string", enum: markets },
            channel: { type: "string", enum: channels },
            amountMajor: { type: "number", description: "In whole currency units, e.g. 905.50", example: 905.5 },
            currency: { type: "string", example: "INR" },
            sampleSize: {
              type: "integer", minimum: 1,
              description: "How many comparable sales. Required — everything downstream weighs the price by it.",
              example: 14,
            },
            dispersionPct: {
              type: ["number", "null"],
              description: "Scatter of those comparables, as ± percent of the median. Not the margin.",
              example: 7.5,
            },
            source: { type: "string", description: "Where it came from. Required.", example: "own closed deals" },
            observedAt: { type: "string", format: "date-time" },
            note: { type: "string" },
          },
          required: ["deviceId", "market", "channel", "amountMajor", "currency", "sampleSize", "source"],
        },
        BulkReport: {
          type: "object",
          properties: {
            dryRun: { type: "boolean" },
            counts: {
              type: "object",
              properties: {
                ok: { type: "integer" }, unresolved: { type: "integer" },
                ambiguous: { type: "integer" }, invalid: { type: "integer" },
              },
            },
            rows: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  line: { type: "integer" },
                  status: { type: "string", enum: ["ok", "unresolved", "ambiguous", "invalid"] },
                  why: { type: "string" },
                  deviceText: { type: "string" },
                  deviceId: { type: "string" },
                  candidates: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        Rate: {
          type: "object",
          properties: {
            base: { type: "string", example: "USD" },
            quote: { type: "string", example: "INR" },
            rate: { type: "number", example: 95.35454354 },
            asOf: { type: "string", format: "date" },
            source: { type: "string", example: "xe.com mid-market 14:10 UTC" },
          },
        },
      },
    },
    security: [{ bearerToken: [] }],
    paths: {
      "/api/oauth/token": {
        post: {
          tags: ["auth"],
          summary: "Exchange client credentials for an access token",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/x-www-form-urlencoded": {
                schema: {
                  type: "object",
                  properties: {
                    grant_type: { type: "string", enum: ["client_credentials"] },
                    client_id: { type: "string" },
                    client_secret: { type: "string" },
                    scope: { type: "string", example: "read write" },
                  },
                  required: ["grant_type"],
                },
              },
            },
          },
          responses: {
            200: { description: "A token", content: { "application/json": { schema: { $ref: "#/components/schemas/Token" } } } },
            400: { description: "Bad grant or scope", content: { "application/json": { schema: { $ref: "#/components/schemas/OAuthError" } } } },
            401: { description: "Client authentication failed", content: { "application/json": { schema: { $ref: "#/components/schemas/OAuthError" } } } },
          },
        },
      },
      "/api/devices": {
        get: {
          tags: ["devices"],
          summary: "Find a device — manufacturer, model, SKU, or free text",
          description: "Never returns the whole catalogue. Give `q`, or walk `brand` then `model`.",
          security: [{ bearerToken: [] }],
          parameters: [
            { name: "q", in: "query", schema: { type: "string" }, description: "Free text across all three levels", example: "iphone 11 pro max 512" },
            { name: "brand", in: "query", schema: { type: "string" } },
            { name: "model", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 40 } },
          ],
          responses: {
            200: {
              description: "Brands, models, SKUs or search results depending on the parameters",
              content: { "application/json": { schema: { type: "object", properties: {
                results: { type: "array", items: { $ref: "#/components/schemas/Device" } },
                brands: { type: "array", items: { type: "object", properties: { brand: { type: "string" }, count: { type: "integer" } } } },
                models: { type: "array", items: { type: "object", properties: { model: { type: "string" }, count: { type: "integer" } } } },
                skus: { type: "array", items: { $ref: "#/components/schemas/Device" } },
              } } } },
            },
          },
        },
      },
      "/api/prices": {
        get: {
          tags: ["prices"],
          summary: "Week-on-week series, or the last figure for one slot",
          security: [{ bearerToken: ["read"] }],
          parameters: [
            { name: "deviceId", in: "query", schema: { type: "string" } },
            { name: "market", in: "query", schema: { type: "string", enum: markets } },
            { name: "channel", in: "query", schema: { type: "string", enum: channels } },
          ],
          responses: { 200: { description: "Series or last entry" } },
        },
        post: {
          tags: ["prices"],
          summary: "Record one market price",
          description:
            "`enteredBy` is taken from the credential, never the body — nothing can be recorded anonymously or attributed to somebody else.",
          security: [{ bearerToken: ["write"] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/MarketPriceInput" } } },
          },
          responses: {
            200: { description: "Recorded", content: { "application/json": { schema: { type: "object", properties: {
              ok: { type: "boolean" }, id: { type: "integer" }, week: { type: "string", example: "2026-W35" } } } } } },
            400: { description: "Rejected before storing", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/api/prices/bulk": {
        post: {
          tags: ["prices"],
          summary: "Import many prices — previews by default",
          description: [
            "Accepts a pasted spreadsheet (`text/plain`, tab or comma separated) or JSON.",
            "DRY RUN unless `commit=1`: an import is the last moment anyone sees the whole",
            "batch before it becomes data. Every row is resolved against the device catalogue",
            "and comes back matched, ambiguous, unresolved or invalid — never a nearest guess.",
          ].join(" "),
          security: [{ bearerToken: ["read", "write"] }],
          parameters: [{ name: "commit", in: "query", schema: { type: "string", enum: ["1"] }, description: "Write the rows marked ok" }],
          requestBody: {
            required: true,
            content: {
              "text/plain": { schema: { type: "string" }, example: "device\tmarket\tchannel\tprice\tcomparables\tsource\niPhone 11 Pro Max (4 GB/512 GB)\tIN\twholesale\t17251.50\t12\town closed deals" },
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    text: { type: "string", description: "Raw CSV/TSV" },
                    rows: { type: "array", items: { type: "object" }, description: "Or objects, converted internally to the same path" },
                    defaults: { type: "object", properties: {
                      market: { type: "string", enum: markets }, channel: { type: "string", enum: channels },
                      currency: { type: "string" }, source: { type: "string" } } },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: "Preview, or the result of a commit", content: { "application/json": { schema: { $ref: "#/components/schemas/BulkReport" } } } },
            400: { description: "Nothing importable — usually a header problem" },
          },
        },
      },
      "/api/rates": {
        get: {
          tags: ["rates"],
          summary: "The rate in force for a pair, with its provenance",
          security: [{ bearerToken: ["read"] }],
          parameters: [
            { name: "base", in: "query", schema: { type: "string", example: "USD" } },
            { name: "quote", in: "query", schema: { type: "string", example: "INR" } },
            { name: "on", in: "query", schema: { type: "string", format: "date" } },
          ],
          responses: { 200: { description: "A rate", content: { "application/json": { schema: { type: "object", properties: { rate: { $ref: "#/components/schemas/Rate" } } } } } } },
        },
        post: {
          tags: ["rates"],
          summary: "Record a rate",
          description: "`source` is required. An unattributed rate once hid a 13% error here in plain sight.",
          security: [{ bearerToken: ["write"] }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Rate" } } } },
          responses: { 200: { description: "Recorded" }, 400: { description: "Rejected" } },
        },
      },
      "/api/export": {
        get: {
          tags: ["export"],
          summary: "Every price in local currency and USD",
          description: `CSV columns: ${EXPORT_COLUMNS.join(", ")}.`,
          security: [{ bearerToken: ["read"] }],
          parameters: [
            { name: "program", in: "query", schema: { type: "string", example: "exchange-in" } },
            { name: "market", in: "query", schema: { type: "string", enum: markets } },
            { name: "format", in: "query", schema: { type: "string", enum: ["csv", "json"], default: "csv" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50000 } },
          ],
          responses: {
            200: {
              description: "A CSV file, or JSON with a summary and the FX provenance",
              content: { "text/csv": { schema: { type: "string" } }, "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
    },
  };
}
