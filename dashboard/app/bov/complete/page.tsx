"use client";

import { useRouter } from "next/navigation";
import { useBovState } from "@/lib/bov-state";
import { BOV_STEPS } from "@/lib/bov-steps";

export default function BovCompletePage() {
    const router = useRouter();
    const { getStep, reset } = useBovState();

    function handleStartOver() {
        reset();
        router.push("/bov/step/1");
    }

    return (
        <div className="flex flex-col gap-6 px-6 py-6 max-w-4xl mx-auto">
            <header>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Step 8 — Complete
                </p>
                <h1 className="mt-1 text-2xl font-semibold">BOV Complete</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    All sections rendered. Review the full BOV below before downloading.
                </p>
            </header>

            {/* Full BOV PDF stack */}
            <div className="flex flex-col gap-3">
                {BOV_STEPS.map((s) => {
                    const data = getStep(s.step);
                    return (
                        <div
                            key={s.step}
                            className="rounded border border-dashed border-foreground/20 bg-muted/10 p-3 text-xs"
                        >
                            <div className="flex items-center justify-between text-muted-foreground">
                                <span className="font-medium">
                                    {s.step}. {s.label}
                                </span>
                                {data.pdfUrl ? (
                                    <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px]">
                                        Rendered
                                    </span>
                                ) : (
                                    <span className="text-foreground/30 text-[10px]">
                                        Not rendered
                                    </span>
                                )}
                            </div>
                            {data.pdfUrl && (
                                <iframe
                                    src={data.pdfUrl}
                                    className="mt-2 h-64 w-full rounded border border-foreground/10"
                                    title={`${s.label} PDF`}
                                />
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
                <button
                    onClick={handleStartOver}
                    className="rounded-md border border-foreground/20 px-4 py-2 text-sm font-medium text-foreground/70 hover:bg-muted"
                >
                    Start over
                </button>
                <button
                    disabled
                    className="rounded-md bg-foreground px-5 py-2 text-sm font-medium text-background opacity-40 cursor-not-allowed"
                >
                    Download BOV PDF
                </button>
            </div>
        </div>
    );
}
