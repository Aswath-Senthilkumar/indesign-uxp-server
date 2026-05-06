import { BuildStateProvider } from "@/lib/build-state";
import BuildStepper from "@/components/build-stepper";

/**
 * Wrapper layout for /build/*. Holds the BuildStateProvider so client
 * state survives navigation between /build/template, /build/comps,
 * /build/edit. Refresh on a deep route resets state — accepted v1
 * limitation.
 */
export default function BuildLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <BuildStateProvider>
            <BuildStepper />
            <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
        </BuildStateProvider>
    );
}
