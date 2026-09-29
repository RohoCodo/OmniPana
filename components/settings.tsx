"use client";

import { useMemo, useState } from "react";
import { Save } from "lucide-react";
import { useWorkspace } from "./workspace";
import { ActionForm, Field, Notice, PageHeader, Panel, Submit, format, number, useOperation } from "./ui";

export function SettingsView() {
  const { data, mutate } = useWorkspace();
  const [locationName, setLocationName] = useState(data.location.name);
  const [locationAddress, setLocationAddress] = useState(data.location.address || "");
  const [varianceThreshold, setVarianceThreshold] = useState(String(data.location.varianceThreshold ?? "10"));
  const op = useOperation();

  const recipeMapped = useMemo(() => data.menuItems.filter(item => item.recipe).length, [data.menuItems]);

  return (
    <>
      <PageHeader
        eyebrow="SETTINGS"
        title="Workspace configuration"
        description="Manage business identity, location details, and inventory discrepancy thresholds."
      />

      <div className="stats-grid three">
        <div className="stat"><div className="stat-label">Organization</div><strong>{data.organization.name}</strong><span>Current workspace owner</span></div>
        <div className="stat"><div className="stat-label">Variance threshold</div><strong>{format(data.location.varianceThreshold, 2)}%</strong><span>Default review trigger</span></div>
        <div className="stat"><div className="stat-label">Recipe coverage</div><strong>{recipeMapped} / {data.menuItems.length}</strong><span>Mapped menu items</span></div>
      </div>

      <div className="two-columns">
        <Panel title="Business & location" subtitle="Used for reports, imports, and receiving context.">
          <ActionForm
            className="panel-body"
            onSubmit={() => op.run(async () => {
              await mutate("settings:location", {
                name: locationName,
                address: locationAddress,
              });
            }, "Location settings saved.")}
          >
            <Field label="Organization">
              <input value={data.organization.name} disabled />
            </Field>
            <Field label="Location name">
              <input value={locationName} onChange={event => setLocationName(event.target.value)} required />
            </Field>
            <Field label="Location address">
              <textarea rows={3} value={locationAddress} onChange={event => setLocationAddress(event.target.value)} />
            </Field>
            {op.feedback}
            <Submit pending={op.pending}><Save size={16} />Save location</Submit>
          </ActionForm>
        </Panel>

        <Panel title="Inventory thresholds" subtitle="Adjust when discrepancies should be marked review recommended.">
          <ActionForm
            className="panel-body"
            onSubmit={() => op.run(async () => {
              const value = number(varianceThreshold);
              if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error("Variance threshold must be between 0 and 100.");
              await mutate("settings:variance-threshold", {
                varianceThreshold,
              });
            }, "Variance threshold saved.")}
          >
            <Field label="Variance threshold %">
              <input type="number" step="0.1" min="0" max="100" value={varianceThreshold} onChange={event => setVarianceThreshold(event.target.value)} required />
            </Field>
            <Notice>
              Variance status remains neutral: NORMAL, REVIEW, CONFIRMED. The system identifies discrepancies only and does not infer wrongdoing.
            </Notice>
            {op.feedback}
            <Submit pending={op.pending}><Save size={16} />Save threshold</Submit>
          </ActionForm>
        </Panel>
      </div>

      <Panel title="Operational summary" subtitle="Quick reference for MVP workflows.">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Area</th>
                <th>Current state</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Toast imports</td>
                <td>{data.imports.length} files</td>
                <td>CSV/JSON workflow with header mapping and duplicate protection.</td>
              </tr>
              <tr>
                <td>Photo counts</td>
                <td>{data.photos.length} uploads</td>
                <td>AI suggestions require human confirmation before ledger postings.</td>
              </tr>
              <tr>
                <td>Receiving</td>
                <td>{data.invoices.length} invoices</td>
                <td>Extraction results are reviewed and confirmed manually.</td>
              </tr>
              <tr>
                <td>Recipes</td>
                <td>{recipeMapped} mapped</td>
                <td>Consumption posts deterministic SALE_CONSUMPTION entries.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
