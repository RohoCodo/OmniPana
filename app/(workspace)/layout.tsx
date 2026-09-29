import { Workspace } from "@/components/workspace";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
	const user = await getSessionUser();
	if (!user) redirect("/login");
	return <Workspace>{children}</Workspace>;
}