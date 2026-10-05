import { NextResponse, type NextRequest } from "next/server"

import { SESSION_COOKIE } from "@/lib/session-cookie"

/** Early redirect only. The real check is verifySession() in lib/dal.ts. */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next()
  return NextResponse.redirect(new URL("/login", request.url))
}

export const config = {
  matcher: ["/((?!login|api/|_next/static|_next/image|favicon.ico).*)"],
}
