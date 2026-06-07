"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBovState } from "@/lib/bov-state";
import { BOV_STEPS, BOV_COMPLETE_STEP } from "@/lib/bov-steps";

interface StepperItem {
    step: number;
    label: string;
    href: string;
}

const ITEMS: StepperItem[] = [
    ...BOV_STEPS.map((s) => ({
        step: s.step,
        label: s.shortLabel,
        href: `/bov/step/${s.step}`,
    })),
    { step: BOV_COMPLETE_STEP, label: "Complete", href: "/bov/complete" },
];

export default function BovStepper() {
    const pathname = usePathname();
    const { getStep } = useBovState();

    const activeStep = (() => {
        if (pathname === "/bov/complete") return BOV_COMPLETE_STEP;
        const m = pathname.match(/\/bov\/step\/(\d+)/);
        return m ? parseInt(m[1], 10) : 1;
    })();

    return (
        <nav aria-label="BOV progress" className="border-b bg-background overflow-x-auto">
            <ol className="flex items-center gap-2 px-6 py-3 text-sm min-w-max">
                <li className="flex items-center gap-2">
                    <Link
                        href="/build/workflow"
                        className="rounded-md px-1 py-0.5 text-foreground/50 hover:text-foreground hover:bg-muted whitespace-nowrap"
                    >
                        ← Workflow
                    </Link>
                    <span aria-hidden className="text-foreground/30 select-none">|</span>
                </li>
                {ITEMS.map((item, i) => {
                    const isActive = item.step === activeStep;
                    const stepData = item.step < BOV_COMPLETE_STEP ? getStep(item.step) : null;
                    const isConfirmed = stepData?.confirmed ?? false;
                    const hasRender = (stepData?.pdfUrl ?? null) !== null;

                    const bubbleCls = isActive
                        ? "border-foreground bg-foreground text-background"
                        : isConfirmed
                            ? "border-foreground/40 bg-foreground/10 text-foreground"
                            : "border-foreground/20 text-foreground/40";

                    const labelCls = isActive
                        ? "font-medium text-foreground"
                        : isConfirmed || item.step < activeStep
                            ? "text-foreground/70"
                            : "text-foreground/40";

                    const inner = (
                        <span className="flex items-center gap-1.5">
                            <span
                                aria-hidden
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs tabular-nums shrink-0 ${bubbleCls}`}
                            >
                                {isConfirmed && !isActive ? "✓" : item.step}
                            </span>
                            <span className={labelCls}>{item.label}</span>
                            {hasRender && !isConfirmed && !isActive && (
                                <span className="h-1.5 w-1.5 rounded-full bg-foreground/40" aria-hidden />
                            )}
                        </span>
                    );

                    return (
                        <li key={item.step} className="flex items-center gap-2">
                            <Link
                                href={item.href}
                                aria-current={isActive ? "step" : undefined}
                                className="rounded-md px-1 py-0.5 hover:bg-muted whitespace-nowrap"
                            >
                                {inner}
                            </Link>
                            {i < ITEMS.length - 1 && (
                                <span aria-hidden className="text-foreground/30 select-none">
                                    →
                                </span>
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
