const capturedRequests = [];

const originalExit = process.exit.bind(process);
process.exit = (code = 0) => {
  const encoded = Buffer.from(JSON.stringify(capturedRequests), "utf8").toString("base64url");
  process.stdout.write(`UAIS_TEST_BYPASS_CAPTURE=${encoded}\n`);
  originalExit(code);
};

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method ?? "GET";
  const headers = new Headers(init.headers);
  const cookie = headers.get("cookie") ?? "";

  capturedRequests.push({
    path: url.pathname,
    method,
    protectionBypass: headers.get("x-vercel-protection-bypass"),
  });

  if (url.pathname === "/api/auth/app-session" && method === "POST") {
    const responseHeaders = new Headers({ "content-type": "application/json" });
    responseHeaders.append("set-cookie", "uais_app_session=test-claims; Path=/; HttpOnly");
    responseHeaders.append(
      "set-cookie",
      "uais_app_session_signature=test-signature; Path=/; HttpOnly",
    );
    return new Response(
      JSON.stringify({ appSession: { actor: { role: "teacher" } } }),
      { status: 200, headers: responseHeaders },
    );
  }

  if (url.pathname === "/api/auth/app-session" && method === "DELETE") {
    return new Response(null, { status: 200 });
  }

  if (url.pathname === "/teaching") {
    if (cookie.includes("invalidsignature") || !cookie) {
      return new Response(null, { status: 307, headers: { location: "/login?from=%2Fteaching" } });
    }
    return new Response("ok", { status: 200 });
  }

  if (url.pathname === "/student-dashboard") {
    return new Response(null, { status: 307, headers: { location: "/teaching" } });
  }

  return new Response("ok", { status: 200 });
};
