import { redirect } from "next/navigation";

// Stage 5 entry point. The new flow lives under /build/*. The Stage 4
// flat picker stays reachable at /legacy for reference during Stage 5
// development.
export default function Home() {
    redirect("/build/template");
}
