export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProxyContext = {
  params: Promise<{
    path: string[];
  }>;
};

type ProxyRequestInit = RequestInit & {
  duplex?: "half";
};

const HOP_BY_HOP_HEADERS = [
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

function normalizeEngineUrl(value: string | undefined): string | null {
  if (!value || value.startsWith("/")) return null;
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function resolveEngineUrl(request: Request): string | null {
  const requestOrigin = new URL(request.url).origin;
  const candidates = [
    process.env.ENGINE_URL,
    process.env.NEXT_PUBLIC_ENGINE_URL,
    process.env.NODE_ENV === "development" ? "http://localhost:8001" : undefined,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeEngineUrl(candidate);
    if (!normalized) continue;

    const candidateUrl = new URL(normalized);
    if (
      candidateUrl.origin === requestOrigin &&
      candidateUrl.pathname.replace(/\/$/, "").startsWith("/api")
    ) {
      continue;
    }

    return normalized;
  }

  return null;
}

function buildTargetUrl(engineUrl: string, path: string[], requestUrl: string) {
  const base = engineUrl.endsWith("/") ? engineUrl : `${engineUrl}/`;
  const target = new URL(path.map(encodeURIComponent).join("/"), base);
  target.search = new URL(requestUrl).search;
  return target;
}

function createProxyHeaders(request: Request) {
  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  return headers;
}

async function proxy(request: Request, context: ProxyContext) {
  const engineUrl = resolveEngineUrl(request);
  if (!engineUrl) {
    return Response.json(
      {
        detail:
          "Engine API is not configured. Set ENGINE_URL to the deployed FastAPI base URL and redeploy.",
      },
      { status: 502 },
    );
  }

  const { path } = await context.params;
  const target = buildTargetUrl(engineUrl, path, request.url);
  const init: ProxyRequestInit = {
    method: request.method,
    headers: createProxyHeaders(request),
    redirect: "manual",
    cache: "no-store",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  try {
    const upstream = await fetch(target, init);
    const headers = new Headers(upstream.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    return Response.json(
      {
        detail: `Engine proxy failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      },
      { status: 502 },
    );
  }
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
