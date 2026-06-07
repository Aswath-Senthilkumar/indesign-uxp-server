"use client";

import { useRouter } from "next/navigation";
import { useBovState } from "@/lib/bov-state";
import { BOV_STEPS, BOV_STEP_COUNT, type BovStepMeta } from "@/lib/bov-steps";
import BovCoverStep    from "@/components/bov-cover-step";
import BovSection1Step from "@/components/bov-section1-step";

// ─── PDF Preview pane ────────────────────────────────────────────────────────

function PdfPreviewPane({ currentStep }: { currentStep: number }) {
    const { getStep } = useBovState();

    const prevSteps = BOV_STEPS.filter((s) => s.step < currentStep);
    const currentMeta = BOV_STEPS.find((s) => s.step === currentStep);

    return (
        <div className="flex flex-col gap-3 overflow-y-auto">
            {/* Previous steps — stacked */}
            {prevSteps.length > 0 && (
                <div className="flex flex-col gap-2">
                    {prevSteps.map((s) => {
                        const data = getStep(s.step);
                        return (
                            <div
                                key={s.step}
                                className="rounded border border-dashed border-foreground/20 bg-muted/30 p-3 text-xs text-muted-foreground"
                            >
                                <div className="flex items-center justify-between">
                                    <span className="font-medium">
                                        {s.step}. {s.label}
                                    </span>
                                    {data.pdfUrl ? (
                                        <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px]">
                                            Rendered
                                        </span>
                                    ) : (
                                        <span className="text-foreground/30 text-[10px]">
                                            Pending
                                        </span>
                                    )}
                                </div>
                                {data.pdfUrl && (
                                    <iframe
                                        src={data.pdfUrl}
                                        className="mt-2 h-48 w-full rounded border border-foreground/10"
                                        title={`Preview — ${s.label}`}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Current step PDF area */}
            <div className="rounded border-2 border-dashed border-foreground/20 bg-muted/10 flex flex-col items-center justify-center min-h-[400px] text-muted-foreground gap-2 p-4">
                {currentMeta && (
                    <p className="text-xs font-medium text-foreground/50 uppercase tracking-wide">
                        {currentMeta.step}. {currentMeta.label}
                    </p>
                )}
                <p className="text-sm">PDF preview will appear here after render</p>
            </div>
        </div>
    );
}

// ─── Full-page static preview (step 5 only) ─────────────────────────────────

function FullStaticView({ meta }: { meta: BovStepMeta }) {
    const router = useRouter();
    const { confirmStep } = useBovState();

    function handleNext() {
        confirmStep(meta.step);
        const next = meta.step + 1;
        router.push(next > BOV_STEP_COUNT ? "/bov/complete" : `/bov/step/${next}`);
    }

    return (
        <div className="flex flex-col gap-6 px-6 py-6">
            <header>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Step {meta.step} of {BOV_STEP_COUNT}
                </p>
                <h1 className="mt-1 text-2xl font-semibold">{meta.label}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Static section — renders as-is, no fields to configure.
                </p>
            </header>

            <div className="rounded border-2 border-dashed border-foreground/20 bg-muted/10 flex items-center justify-center min-h-[600px] text-muted-foreground">
                <p className="text-sm">PDF preview will appear here</p>
            </div>

            <div className="flex justify-end">
                <button
                    onClick={handleNext}
                    className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90"
                >
                    Next →
                </button>
            </div>
        </div>
    );
}

// ─── Split-screen dynamic step ───────────────────────────────────────────────

function DynamicStepView({ meta }: { meta: BovStepMeta }) {
    const router = useRouter();
    const { confirmStep } = useBovState();

    function handleNext() {
        confirmStep(meta.step);
        const next = meta.step + 1;
        router.push(next > BOV_STEP_COUNT ? "/bov/complete" : `/bov/step/${next}`);
    }

    return (
        <div className="grid grid-cols-2 gap-0 h-[calc(100vh-48px)]">
            {/* Left 50% — edit form */}
            <div className="flex flex-col overflow-y-auto border-r border-foreground/10">
                <div className="border-b border-foreground/10 px-5 py-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Step {meta.step} of {BOV_STEP_COUNT}
                    </p>
                    <h1 className="mt-0.5 text-lg font-semibold">{meta.label}</h1>
                </div>

                <div className="flex-1 px-5 py-5">
                    <div className="rounded border border-dashed border-foreground/20 bg-muted/10 flex items-center justify-center min-h-[300px] text-muted-foreground p-6 text-center">
                        <p className="text-sm">
                            Field inputs will appear here once the template is wired.
                        </p>
                    </div>
                </div>

                <div className="border-t border-foreground/10 px-5 py-4 flex items-center justify-between gap-3">
                    <button
                        disabled
                        className="rounded-md border border-foreground/20 px-4 py-2 text-sm font-medium text-foreground/40 cursor-not-allowed"
                    >
                        Render
                    </button>
                    <button
                        onClick={handleNext}
                        className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90"
                    >
                        Next →
                    </button>
                </div>
            </div>

            {/* Right 50% — PDF preview */}
            <div className="overflow-y-auto p-6">
                <PdfPreviewPane currentStep={meta.step} />
            </div>
        </div>
    );
}

// ─── Split-screen static step (step 7) ───────────────────────────────────────

function StaticStepView({ meta }: { meta: BovStepMeta }) {
    const router = useRouter();
    const { confirmStep } = useBovState();

    function handleNext() {
        confirmStep(meta.step);
        const next = meta.step + 1;
        router.push(next > BOV_STEP_COUNT ? "/bov/complete" : `/bov/step/${next}`);
    }

    return (
        <div className="grid grid-cols-2 gap-0 h-[calc(100vh-48px)]">
            {/* Left 50% — static notice */}
            <div className="flex flex-col overflow-y-auto border-r border-foreground/10">
                <div className="border-b border-foreground/10 px-5 py-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Step {meta.step} of {BOV_STEP_COUNT}
                    </p>
                    <h1 className="mt-0.5 text-lg font-semibold">{meta.label}</h1>
                </div>

                <div className="flex-1 px-5 py-5 flex items-center justify-center">
                    <p className="text-sm text-muted-foreground text-center">
                        Static section — renders as-is, no fields to configure.
                    </p>
                </div>

                <div className="border-t border-foreground/10 px-5 py-4 flex justify-end">
                    <button
                        onClick={handleNext}
                        className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90"
                    >
                        Next →
                    </button>
                </div>
            </div>

            {/* Right 50% — PDF preview */}
            <div className="overflow-y-auto p-6">
                <PdfPreviewPane currentStep={meta.step} />
            </div>
        </div>
    );
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export default function BovStepView({ meta }: { meta: BovStepMeta }) {
    if (meta.step === 5) return <FullStaticView meta={meta} />;
    if (meta.step === 1) return <BovCoverStep />;
    if (meta.step === 2) return <BovSection1Step />;
    if (meta.type === "static") return <StaticStepView meta={meta} />;
    return <DynamicStepView meta={meta} />;
}
