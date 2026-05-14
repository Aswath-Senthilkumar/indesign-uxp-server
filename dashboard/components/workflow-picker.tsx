"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useBuildState } from "@/lib/build-state";
import type { WorkflowMeta } from "@/lib/workflows";

interface WorkflowPickerProps {
    workflows: WorkflowMeta[];
}

export default function WorkflowPicker({ workflows }: WorkflowPickerProps) {
    const router = useRouter();
    const { workflow: selectedFromState, setWorkflow } = useBuildState();

    const [selectedId, setSelectedId] = useState<string | null>(
        selectedFromState ?? null
    );

    function handleContinue() {
        if (!selectedId) return;
        const w = workflows.find((x) => x.id === selectedId);
        if (!w || !w.available) return;
        setWorkflow(w.id);
        router.push("/build/template");
    }

    return (
        <section className="space-y-6">
            <header>
                <h1 className="text-2xl font-semibold tracking-tight">
                    Choose a workflow
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Two automation paths — team-sheet PDFs from a fixed-tile
                    layout, or a multi-page BOV for a subject property.
                </p>
            </header>

            <ul className="grid gap-3 md:grid-cols-2">
                {workflows.map((w) => {
                    const isSelected = w.available && selectedId === w.id;
                    const isDisabled = !w.available;
                    return (
                        <li key={w.id}>
                            <Card
                                aria-disabled={isDisabled || undefined}
                                className={`flex flex-col gap-3 p-4 transition-colors ${
                                    isDisabled
                                        ? "opacity-60"
                                        : isSelected
                                            ? "border-foreground/40 bg-muted/40"
                                            : "hover:bg-muted/20"
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <h2 className="truncate text-base font-medium">
                                            {w.label}
                                        </h2>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            {w.description}
                                        </p>
                                    </div>
                                    {isDisabled ? (
                                        <span className="shrink-0 rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-foreground/70">
                                            Coming soon
                                        </span>
                                    ) : isSelected ? (
                                        <span className="shrink-0 rounded-full bg-foreground px-2 py-0.5 text-xs font-medium text-background">
                                            Selected
                                        </span>
                                    ) : null}
                                </div>

                                {isDisabled && w.comingSoonNote ? (
                                    <p className="text-xs text-muted-foreground">
                                        {w.comingSoonNote}
                                    </p>
                                ) : null}

                                <div className="mt-1">
                                    <Button
                                        variant={isSelected ? "secondary" : "default"}
                                        disabled={isDisabled}
                                        onClick={() =>
                                            !isDisabled && setSelectedId(w.id)
                                        }
                                    >
                                        {isDisabled
                                            ? "Unavailable"
                                            : isSelected
                                                ? "Selected"
                                                : "Select"}
                                    </Button>
                                </div>
                            </Card>
                        </li>
                    );
                })}
            </ul>

            <div className="flex items-center gap-3 pt-2">
                <Button
                    size="lg"
                    disabled={
                        !selectedId ||
                        !workflows.find((w) => w.id === selectedId)?.available
                    }
                    onClick={handleContinue}
                >
                    Continue
                </Button>
                <p className="text-xs text-muted-foreground">
                    {selectedId
                        ? "Continue moves to template selection."
                        : "Select a workflow to continue."}
                </p>
            </div>
        </section>
    );
}
