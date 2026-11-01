import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default function Admin() {
  const session = cookies().get("session");
  if (!session) {
    redirect("/login");
  }
  return <h1>Admin dashboard</h1>;
}
