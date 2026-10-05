import { Button } from "@workspace/ui/components/button"
import { LockKeyholeIcon, LogOutIcon } from "lucide-react"

import { logout } from "@/actions/auth"
import { HealthBanner } from "@/components/health-banner"
import { NavLinks } from "@/components/nav-links"
import { verifySession } from "@/lib/dal"
import { zigbee } from "@/lib/zigbee"

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  await verifySession()
  const health = await zigbee.health()

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-5 px-4 py-5">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b pb-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <LockKeyholeIcon className="size-4" aria-hidden />
          SmartEntry
        </div>
        <NavLinks />
        <form action={logout}>
          <Button type="submit" variant="ghost" size="sm">
            <LogOutIcon data-icon="inline-start" aria-hidden />
            Sair
          </Button>
        </form>
      </header>
      <HealthBanner health={health} />
      <main className="flex flex-col gap-5">{children}</main>
    </div>
  )
}
