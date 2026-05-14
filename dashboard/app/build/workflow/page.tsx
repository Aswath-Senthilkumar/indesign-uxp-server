import WorkflowPicker from "@/components/workflow-picker";
import { WORKFLOW_LIST } from "@/lib/workflows";

// Server Component: hands the workflow list (from the registry) to
// the client picker. State (selected workflow + downstream stages)
// lives in BuildState; the picker's Continue button writes to it
// before navigating to /build/template.
export default function BuildWorkflowPage() {
    return <WorkflowPicker workflows={WORKFLOW_LIST} />;
}
