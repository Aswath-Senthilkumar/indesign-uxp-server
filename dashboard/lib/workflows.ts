/*
 * Workflow registry.
 *
 * A workflow is a top-level mode of the build flow that gates which
 * templates are available downstream. Each template's manifest.json
 * declares the workflow it belongs to (`workflow: "team-sheets"` etc.),
 * and the template picker filters its list against the workflow held
 * in BuildState.
 *
 * Adding a new workflow: add an entry below + add an `available: true`
 * flag once there's at least one template assigned to it. The workflow
 * picker reads this registry directly — no other code change is needed
 * to surface the new option.
 */

export type WorkflowId = "team-sheets" | "bov";

export interface WorkflowMeta {
    id: WorkflowId;
    label: string;
    description: string;
    /**
     * `false` keeps the card visible but non-interactive on the
     * workflow picker, with a "Coming soon" pill. Flip to `true` when
     * at least one template's manifest declares this workflow.
     */
    available: boolean;
    comingSoonNote?: string;
}

export const WORKFLOWS: Record<WorkflowId, WorkflowMeta> = {
    "team-sheets": {
        id: "team-sheets",
        label: "Team Sheets",
        description:
            "Recently-leased and recently-sold layouts. Pick a template, pick comps, render.",
        available: true,
    },
    bov: {
        id: "bov",
        label: "BOV",
        description:
            "Broker Opinion of Value. Multi-page comparable sets for a subject property.",
        available: false,
        comingSoonNote:
            "BOV automation is in scoping. Will land as a heavily-customized single template with per-page comp distribution.",
    },
};

export const WORKFLOW_LIST: WorkflowMeta[] = Object.values(WORKFLOWS);

export function isWorkflowId(v: unknown): v is WorkflowId {
    return typeof v === "string" && v in WORKFLOWS;
}
