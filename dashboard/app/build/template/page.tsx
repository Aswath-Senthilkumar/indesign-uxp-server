import { loadManifest } from "@/lib/manifest";
import TemplatePicker from "@/components/template-picker";

// Server Component: reads the manifest at request time and hands the
// list to the client picker, which holds selection state and triggers
// introspection on Continue.
export default async function BuildTemplatePage() {
    const templates = await loadManifest();
    return <TemplatePicker templates={templates} />;
}
