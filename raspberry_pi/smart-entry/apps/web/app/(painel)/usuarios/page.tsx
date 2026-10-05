import { UsersManager } from "@/components/users-manager"
import { verifySession } from "@/lib/dal"
import { errorMessage } from "@/lib/messages"
import { zigbee } from "@/lib/zigbee"

export default async function UsuariosPage() {
  await verifySession()
  const users = await zigbee.listUsers()

  if (!users.ok) {
    return <p className="text-xs text-muted-foreground">{errorMessage(users.error)}</p>
  }
  return <UsersManager users={users.data.users} />
}
