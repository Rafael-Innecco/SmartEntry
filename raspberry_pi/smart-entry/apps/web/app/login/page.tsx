import { redirect } from "next/navigation"

import { LoginForm } from "@/components/login-form"
import { isAdmin } from "@/lib/dal"

export default async function LoginPage() {
  if (await isAdmin()) redirect("/")

  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <LoginForm />
    </main>
  )
}
