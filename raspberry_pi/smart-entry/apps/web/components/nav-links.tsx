"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@workspace/ui/lib/utils"

const LINKS = [
  { href: "/", label: "Início" },
  { href: "/usuarios", label: "Usuários" },
  { href: "/acessos", label: "Acessos" },
]

export function NavLinks() {
  const pathname = usePathname()

  return (
    <nav aria-label="Seções do painel" className="order-last flex w-full gap-1 sm:order-none sm:w-auto">
      {LINKS.map(({ href, label }) => {
        const active = pathname === href
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none",
              active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
