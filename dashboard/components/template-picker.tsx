"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useBuildState } from "@/lib/build-state";
import type { TemplateManifestEntry } from "@/lib/manifest";
import { WORKFLOWS } from "@/lib/workflows";

interface TemplatePickerProps {
    templates: TemplateManifestEntry[];
}

interface IntrospectError {
    error: string;
    detail?: string;
    hint?: string;
}

function fieldChip(label: string, kind: "tile" | "page") {
    const cls =
        kind === "tile"
            ? "bg-foreground/5 text-foreground/80 border-foreground/10"
            : "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-300";
    return (
        <span
            key={`${kind}-${label}`}
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}
        >
            {label}
        </span>
    );
}

function fieldLabel(field: string): string {
    // turn snake_case -> Title Case for chip labels
    return field
        .split("_")
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" ");
}

export default function TemplatePicker({ templates }: TemplatePickerProps) {
    const router = useRouter();
    const { workflow, template: selectedFromState, setTemplate } = useBuildState();

    const [selectedId, setSelectedId] = useState<string | null>(
        selectedFromState?.id ?? null
    );
    const [continuing, setContinuing] = useState(false);
    const [error, setError] = useState<{ message: string; detail?: string } | null>(
        null
    );

    // Filter the global template list down to those declared for the
    // selected workflow. Recovery state below catches the workflow-not-
    // picked case before this is used.
    const workflowTemplates = useMemo(
        () =>
            workflow === null
                ? []
                : templates.filter((t) => t.workflow === workflow),
        [templates, workflow]
    );

    async function handleContinue() {
        if (!selectedId || continuing) return;
        const tpl = templates.find((t) => t.id === selectedId);
        if (!tpl) return;

        setContinuing(true);
        setError(null);
        try {
            const r = await fetch(
                `/api/templates/${encodeURIComponent(tpl.id)}/introspect`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                }
            );
            if (!r.ok) {
                const body = (await r.json()) as IntrospectError;
                setError({
                    message: body.error ?? `introspection failed (HTTP ${r.status})`,
                    detail: [body.hint, body.detail].filter(Boolean).join(" — "),
                });
                setContinuing(false);
                return;
            }
            const body = (await r.json()) as {
                tileCount: number;
                gridCols?: number;
                tileFieldNames?: string[];
            };
            setTemplate({
                id: tpl.id,
                label: tpl.label,
                tileCount: body.tileCount,
                gridCols: body.gridCols,
                tileFieldNames: body.tileFieldNames,
            });
            router.push("/build/comps");
        } catch (e) {
            setError({
                message: "Network error reaching the dashboard.",
                detail: (e as Error).message,
            });
            setContinuing(false);
        }
    }

    if (workflow === null) {
        return (
            <Card className="space-y-3 p-6">
                <p className="text-sm">
                    No workflow selected. The build flow starts at workflow
                    selection.
                </p>
                <Link
                    href="/build/workflow"
                    className={buttonVariants({ size: "lg" })}
                >
                    Go to workflow selection
                </Link>
            </Card>
        );
    }

    const workflowLabel = WORKFLOWS[workflow].label;

    return (
        <section className="space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="truncate text-2xl font-semibold tracking-tight">
                        Choose a template
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Workflow:{" "}
                        <span className="font-medium text-foreground">
                            {workflowLabel}
                        </span>
                        {" · "}each template has a fixed field set; pick the one
                        that fits the sheet you&apos;re building.
                    </p>
                </div>
                <Link
                    href="/build/workflow"
                    className="text-sm underline text-muted-foreground hover:text-foreground"
                >
                    Change workflow
                </Link>
            </header>

            {workflowTemplates.length === 0 ? (
                <Card className="p-6 text-sm text-muted-foreground">
                    No templates declared for the{" "}
                    <span className="font-medium text-foreground">
                        {workflowLabel}
                    </span>{" "}
                    workflow yet. Add one under{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">
                        dashboard/templates/{workflow}/&lt;TemplateName&gt;/manifest.json
                    </code>
                    .
                </Card>
            ) : null}

            <ul className="grid gap-3 md:grid-cols-2">
                {workflowTemplates.map((tpl) => {
                    const isSelected = selectedId === tpl.id;
                    return (
                        <li key={tpl.id}>
                            <Card
                                className={`flex flex-col gap-3 p-4 transition-colors ${
                                    isSelected
                                        ? "border-foreground/40 bg-muted/40"
                                        : "hover:bg-muted/20"
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <h2 className="truncate text-base font-medium">
                                            {tpl.label}
                                        </h2>
                                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                            {tpl.file}
                                        </p>
                                    </div>
                                    {isSelected ? (
                                        <span className="shrink-0 rounded-full bg-foreground px-2 py-0.5 text-xs font-medium text-background">
                                            Selected
                                        </span>
                                    ) : null}
                                </div>

                                <div className="space-y-2">
                                    <div>
                                        <p className="text-xs font-medium text-foreground/60">
                                            Tile fields
                                        </p>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            {tpl.tile_fields.map((f) =>
                                                fieldChip(fieldLabel(f.field), "tile")
                                            )}
                                        </div>
                                    </div>
                                    {tpl.page_fields.length > 0 ? (
                                        <div>
                                            <p className="text-xs font-medium text-foreground/60">
                                                Page-level fields
                                            </p>
                                            <div className="mt-1 flex flex-wrap gap-1">
                                                {tpl.page_fields.map((f) =>
                                                    fieldChip(fieldLabel(f.field), "page")
                                                )}
                                            </div>
                                        </div>
                                    ) : null}
                                </div>

                                <div className="mt-1 flex items-center gap-2">
                                    <Button
                                        variant={isSelected ? "secondary" : "default"}
                                        onClick={() => setSelectedId(tpl.id)}
                                    >
                                        {isSelected ? "Selected" : "Select"}
                                    </Button>
                                    <a
                                        href={`/api/templates/${encodeURIComponent(tpl.id)}/preview`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={buttonVariants({ variant: "outline" })}
                                    >
                                        Preview
                                    </a>
                                </div>
                            </Card>
                        </li>
                    );
                })}
            </ul>

            {error ? (
                <Card
                    role="alert"
                    className="border-destructive/40 bg-destructive/5 p-4"
                >
                    <p className="text-sm font-medium text-destructive">
                        {error.message}
                    </p>
                    {error.detail ? (
                        <p className="mt-1 text-xs text-destructive/80">
                            {error.detail}
                        </p>
                    ) : null}
                </Card>
            ) : null}

            <div className="flex items-center gap-3 pt-2">
                <Button
                    size="lg"
                    disabled={!selectedId || continuing}
                    onClick={handleContinue}
                    aria-busy={continuing}
                >
                    {continuing ? "Loading template…" : "Continue"}
                </Button>
                <p className="text-xs text-muted-foreground">
                    {continuing
                        ? "Counting tiles in the template via the bridge."
                        : selectedId
                            ? "Continue resolves tile count and moves to comp selection."
                            : "Select a template to continue."}
                </p>
            </div>
        </section>
    );
}
