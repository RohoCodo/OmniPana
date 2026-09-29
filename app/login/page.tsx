import { AuthPage } from "@/components/auth";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
	if (await getSessionUser()) redirect("/dashboard");
	return <AuthPage />;
}