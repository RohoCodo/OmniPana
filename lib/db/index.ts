import { prisma } from "../prisma";

export const db = prisma;

const ansiPattern = /\u001b\[[0-9;]*m/g;

function clean(text: string) {
	return text.replace(ansiPattern, "").trim();
}

export function friendlyDbErrorMessage(error: unknown, fallback: string) {
	const raw = error instanceof Error ? clean(error.message) : "";
	const lower = raw.toLowerCase();
	if (lower.includes("environment variable not found") && lower.includes("database_url")) {
		return "Database is not configured. Add DATABASE_URL in your .env file and restart the app.";
	}
	if (lower.includes("can't reach database server") || lower.includes("connection refused") || lower.includes("timed out")) {
		return "Database is unavailable. Start your database connection and try again.";
	}
	return fallback;
}