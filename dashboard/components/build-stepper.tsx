"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBuildState } from "@/lib/build-state";

interface Step {
    id: "template" | "comps" | "edit";
    label: string;
    href: string;
}

const STEPS: Step[] = [
    { id: "template", label: "Template", href: "/build/template" },
    { id: "comps", label: "Comps", href: "/build/comps" },
    { id: "edit", label: "Edit & Render", href: "/build/edit" },
];

export default function BuildStepper() {
    const pathname = usePathname();
    const { template, comps } = useBuildState();

    // Derive completion gates. A step is "complete" only when its
    // outputs are present in state, which is also the gate that lets
    // the user navigate forward via the stepper.
    const stepsComplete: Record<Step["id"], boolean> = {
        template: template !== null,
        comps:
            template !== null &&
            template.tileCount > 0 &&
            comps.length === template.tileCount,
        edit: false, // edit has no follow-on stage
    };

    const currentIdx = STEPS.findIndex((s) => pathname.startsWith(s.href));

    return (
        <nav aria-label="Build progress" className="border-b bg-background">
            <ol className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-3 text-sm">
                {STEPS.map((step, i) => {
                    const isActive = i === currentIdx;
                    const isComplete = stepsComplete[step.id];
                    // Step is reachable if it's the current one OR every prior
                    // step is complete. This lets the user click backward to
                    // revise but blocks forward jumps until prerequisites land.
                    const isReachable =
                        isActive ||
                        STEPS.slice(0, i).every((s) => stepsComplete[s.id]);

                    const indexBubbleCls = isActive
                        ? "border-foreground bg-foreground text-background"
                        : isComplete
                            ? "border-foreground/40 bg-foreground/10 text-foreground"
                            : "border-foreground/20 text-foreground/40";

                    const labelCls = isActive
                        ? "font-medium text-foreground"
                        : isReachable
                            ? "text-foreground/70"
                            : "text-foreground/40";

                    const inner = (
                        <span className="flex items-center gap-2">
                            <span
                                aria-hidden
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs tabular-nums ${indexBubbleCls}`}
                            >
                                {isComplete && !isActive ? "✓" : i + 1}
                            </span>
                            <span className={labelCls}>{step.label}</span>
                        </span>
                    );

                    return (
                        <li key={step.id} className="flex items-center gap-3">
                            {isReachable ? (
                                <Link
                                    href={step.href}
                                    aria-current={isActive ? "step" : undefined}
                                    className="rounded-md px-1 py-0.5 hover:bg-muted"
                                >
                                    {inner}
                                </Link>
                            ) : (
                                <span
                                    aria-disabled="true"
                                    className="px-1 py-0.5 cursor-not-allowed"
                                >
                                    {inner}
                                </span>
                            )}
                            {i < STEPS.length - 1 ? (
                                <span aria-hidden className="text-foreground/30">
                                    →
                                </span>
                            ) : null}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
