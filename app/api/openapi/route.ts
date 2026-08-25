import { NextRequest, NextResponse } from "next/server";
import { openApiDocument } from "@/lib/openapi.ts";

export const dynamic = "force-dynamic";

/**
 * The API description, as JSON or YAML.
 *
 *   GET /priceiq/api/openapi            → JSON
 *   GET /priceiq/api/openapi?format=yaml → YAML
 *
 * DELIBERATELY UNAUTHENTICATED. A client cannot sensibly authenticate before it
 * knows how to authenticate, and the document describes shapes rather than
 * data — no price, device or rate appears in it.
 */
export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const origin = req.nextUrl.origin;
  const doc = openApiDocument(`${origin}${base}`);

  if ((req.nextUrl.searchParams.get("format") || "").toLowerCase() === "yaml") {
    return new NextResponse(toYaml(doc), {
      headers: {
        "Content-Type": "application/yaml; charset=utf-8",
        "Content-Disposition": 'inline; filename="priceiq-openapi.yaml"',
      },
    });
  }
  return NextResponse.json(doc);
}

/**
 * Minimal YAML emitter.
 *
 * Hand-written rather than pulled in as a dependency: this serialises one
 * known-shaped document of plain objects, arrays, strings, numbers and
 * booleans, and adding a package to the runtime for that is a poor trade.
 * Strings are quoted whenever they could be read as anything else, which is the
 * only part of YAML that actually bites.
 */
function toYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);

  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return yamlString(value, indent);

  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return value
      .map((v) => {
        const rendered = toYaml(v, indent + 1);
        return isScalar(v) ? `${pad}- ${rendered}` : `${pad}-\n${rendered}`;
      })
      .join("\n");
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (!entries.length) return "{}";
  return entries
    .map(([k, v]) => {
      const key = /^[A-Za-z_][\w.-]*$/.test(k) ? k : JSON.stringify(k);
      if (isScalar(v)) return `${pad}${key}: ${toYaml(v, indent)}`;
      if (Array.isArray(v) && !v.length) return `${pad}${key}: []`;
      return `${pad}${key}:\n${toYaml(v, indent + 1)}`;
    })
    .join("\n");
}

const isScalar = (v: unknown) =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

function yamlString(s: string, indent: number): string {
  if (s.includes("\n")) {
    // Block scalar, so descriptions keep their line breaks.
    const pad = "  ".repeat(indent + 1);
    return "|-\n" + s.split("\n").map((l) => pad + l).join("\n");
  }
  // Quote anything that could parse as something other than a string.
  const risky = /^[\s>|&*!%@`{}[\],#-]|:\s|\s#|^$|^(?:true|false|null|yes|no|on|off|~)$/i.test(s) ||
    /^[+-]?(\d|\.\d)/.test(s);
  return risky ? JSON.stringify(s) : s;
}
