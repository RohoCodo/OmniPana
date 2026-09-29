import { AuthPage } from "@/components/auth";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
export const metadata = { title: "Create your workspace" };

export default async function RegisterPage() {
	if (await getSessionUser()) redirect("/dashboard");
	return <AuthPage register />;
}