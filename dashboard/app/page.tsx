import { redirect } from "next/navigation";

// Entry point. The build flow now lives at /build/workflow ->
// /build/template -> /build/comps -> /build/edit. The Stage 4 flat
// picker stays reachable at /legacy.
export default function Home() {
    redirect("/build/workflow");
}
