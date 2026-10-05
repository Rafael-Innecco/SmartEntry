import { isAdmin } from "@/lib/dal"
import { zigbee } from "@/lib/zigbee"

/** Polled every 3 s by the dashboard. Server Actions run one at a time, so polling can't use them. */
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: "unauthorized" }, { status: 401 })
  const result = await zigbee.status()
  return result.ok
    ? Response.json(result.data)
    : Response.json({ error: result.error }, { status: 502 })
}
