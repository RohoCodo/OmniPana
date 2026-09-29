import Link from "next/link";

export const metadata = { title: "Sales & imports" };

export default function SalesPage() {
  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sales & imports</h1>
        <p className="mt-2 text-sm text-gray-600">
          Bring in Toast exports, map columns, then convert sales into deterministic theoretical consumption.
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-semibold">Import workflow</h2>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-gray-700">
          <li>Upload CSV/JSON exports for sales, menu, or opening inventory.</li>
          <li>Review detected headers and map required fields.</li>
          <li>Validate rows and import with duplicate protection.</li>
          <li>Map recipes so sales can be translated into ingredient consumption.</li>
        </ol>
        <Link
          href="/sales/import"
          className="mt-5 inline-flex rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
        >
          Start Toast import
        </Link>
      </section>
    </main>
  );
}
