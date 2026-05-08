"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import {
    SortableContext,
    arrayMove,
    rectSortingStrategy,
    sortableKeyboardCoordinates,
    useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useBuildState } from "@/lib/build-state";
import {
    type Comp,
    formatPriceLine,
    formatSfAc,
    formatStatusBadge,
} from "@/lib/format";

interface PageFieldMeta {
    field: string;
    frame: string;
    label: string;
    current_value: string;
    missing: boolean;
}

type RenderState =
    | { kind: "idle" }
    | { kind: "loading" }
    | {
          kind: "success";
          blobUrl: string;
          bytes: number;
          serverWallMs: number | null;
          appliedOverrides: string[];
          skippedOverrides: string[];
      }
    | { kind: "error"; message: string; detail?: string };

interface RenderApiError {
    error: string;
    detail?: string;
    hint?: string;
    details?: Array<{ field: string; message: string }>;
}

// Stage 6: thumbnail src is now Comp.image_url (a Supabase storage URL)
// instead of a local mock-data filename routed through /api/images.
// Track B handles the same data on the render path (fetch -> temp file).

// Tile-grid column class. When the template's manifest declares
// `grid.cols`, we use that as the desktop count so the dashboard mirrors
// the actual InDesign layout (e.g. the 6_Tile_Defaults sheet is
// 2 cols × 3 rows in the .indd, so the drag grid should match). Without
// the manifest hint, fall back to a count-based heuristic.
//
// Tailwind's purge needs the column class names to appear as static
// strings — we map the numeric cols to a finite set rather than building
// strings dynamically.
function gridColsClass(cols: number): string {
    switch (cols) {
        case 1:
            return "grid-cols-1";
        case 2:
            return "grid-cols-1 sm:grid-cols-2";
        case 3:
            return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
        case 4:
            return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";
        case 5:
            return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-5";
        case 6:
            return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-6";
        default:
            return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
    }
}

function heuristicCols(count: number): number {
    if (count <= 4) return 2;
    if (count <= 9) return 3;
    return 4;
}

interface SortableTileCardProps {
    comp: Comp;
    index: number;
    onRemove: (id: string) => void;
    showStatus: boolean;
    showPrice: boolean;
}

function SortableTileCard({
    comp,
    index,
    onRemove,
    showStatus,
    showPrice,
}: SortableTileCardProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: comp.id });

    const [imgFailed, setImgFailed] = useState(false);

    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : "auto",
    };

    return (
        <Card
            ref={setNodeRef}
            style={style}
            className={`relative flex flex-col gap-2 p-3 ${
                isDragging ? "shadow-lg ring-2 ring-foreground/20" : ""
            }`}
        >
            <div className="flex items-start justify-between gap-2">
                <span className="inline-flex h-6 items-center rounded-full bg-foreground/10 px-2 text-xs font-semibold tabular-nums">
                    Tile {index + 1}
                </span>
                <button
                    type="button"
                    aria-label={`Remove ${comp.address}`}
                    onClick={() => onRemove(comp.id)}
                    className="rounded p-1 text-foreground/50 hover:bg-muted hover:text-foreground"
                >
                    ×
                </button>
            </div>
            {imgFailed || !comp.image_url ? (
                <div className="flex h-24 w-full items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                    No image
                </div>
            ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                    src={comp.image_url}
                    alt=""
                    loading="lazy"
                    onError={() => setImgFailed(true)}
                    className="h-24 w-full rounded-md object-cover bg-muted"
                />
            )}
            {/* Drag handle: the body of the card is grabbable. The remove
                button has its own click handler which short-circuits. */}
            <div
                {...attributes}
                {...listeners}
                className="cursor-grab select-none active:cursor-grabbing"
            >
                <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-medium flex-1 min-w-0">
                        {comp.address}
                    </p>
                    {showStatus ? (
                        <span className="shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/70">
                            {formatStatusBadge(comp.status) || "—"}
                        </span>
                    ) : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                    {comp.city}, {comp.state}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                    {formatSfAc(comp.building_sf, comp.land_area)}
                </p>
                {showPrice ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {formatPriceLine({
                            sale_price: comp.sale_price,
                            base_rent_total: comp.base_rent_total,
                            lease_format: comp.lease_format,
                        })}
                    </p>
                ) : null}
            </div>
        </Card>
    );
}

export default function EditRender() {
    const { template, comps, setComps, pageOverrides, setPageOverride } =
        useBuildState();

    // Local state independent of BuildState
    const [pageFields, setPageFields] = useState<PageFieldMeta[] | null>(null);
    const [pageFieldsLoading, setPageFieldsLoading] = useState(false);
    const [pageFieldsError, setPageFieldsError] = useState<string | null>(null);
    const [renderState, setRenderState] = useState<RenderState>({ kind: "idle" });
    // Tracks whether tile order or page fields changed since the last
    // successful render. Drives the "re-render to see changes" hint.
    const [dirtySinceRender, setDirtySinceRender] = useState(false);
    const fieldsFetchedFor = useRef<string | null>(null);

    // Local wrappers around the BuildState setters: any user-driven mutation
    // marks the rendered preview stale. Reset to clean on every successful
    // render below.
    function handleSetComps(next: Comp[]) {
        setComps(next);
        setDirtySinceRender(true);
    }
    function handleSetPageOverride(field: string, value: string) {
        setPageOverride(field, value);
        setDirtySinceRender(true);
    }

    // Revoke blob URL on next render or unmount
    useEffect(() => {
        const url =
            renderState.kind === "success" ? renderState.blobUrl : null;
        return () => {
            if (url) URL.revokeObjectURL(url);
        };
    }, [renderState]);

    // Pre-populate page fields once per template change.
    useEffect(() => {
        if (!template) return;
        if (fieldsFetchedFor.current === template.id) return;
        fieldsFetchedFor.current = template.id;

        setPageFieldsLoading(true);
        setPageFieldsError(null);
        fetch(
            `/api/templates/${encodeURIComponent(template.id)}/page-fields`,
            { cache: "no-store" }
        )
            .then(async (r) => {
                if (!r.ok) {
                    const body = (await r.json().catch(() => null)) as
                        | RenderApiError
                        | null;
                    throw new Error(
                        body?.error ?? `failed to read page fields (HTTP ${r.status})`
                    );
                }
                const body = (await r.json()) as { fields: PageFieldMeta[] };
                setPageFields(body.fields);
            })
            .catch((e) => {
                setPageFieldsError((e as Error).message);
            })
            .finally(() => setPageFieldsLoading(false));
    }, [template]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    function onDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const oldIndex = comps.findIndex((c) => c.id === active.id);
        const newIndex = comps.findIndex((c) => c.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return;
        handleSetComps(arrayMove(comps, oldIndex, newIndex));
    }

    function onRemoveTile(id: string) {
        handleSetComps(comps.filter((c) => c.id !== id));
    }

    // Resolve effective page-field values: BuildState override -> current
    // value -> empty string. Used to populate inputs.
    function valueFor(field: string): string {
        if (Object.prototype.hasOwnProperty.call(pageOverrides, field)) {
            return pageOverrides[field];
        }
        return pageFields?.find((f) => f.field === field)?.current_value ?? "";
    }

    const tileCount = template?.tileCount ?? 0;
    const allRequiredOverridesNonEmpty = useMemo(() => {
        if (!pageFields) return true; // not loaded yet — don't block
        return pageFields.every((f) => valueFor(f.field).trim().length > 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageFields, pageOverrides]);

    const canRender =
        template !== null &&
        comps.length === tileCount &&
        renderState.kind !== "loading" &&
        !pageFieldsLoading &&
        allRequiredOverridesNonEmpty;

    async function onRender() {
        if (!template || !canRender) return;
        setRenderState({ kind: "loading" });

        // Build the overrides payload only from fields the user actually
        // edited (i.e. that exist in pageOverrides). Empty values get
        // dropped server-side so the template default stays.
        const overridesOut: Record<string, string> = {};
        for (const [k, v] of Object.entries(pageOverrides)) {
            if (typeof v === "string" && v.length > 0) overridesOut[k] = v;
        }

        const payload = {
            template_id: template.id,
            tile_count: template.tileCount,
            comps,
            page_overrides: overridesOut,
        };

        let res: Response;
        try {
            res = await fetch("/api/render", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
        } catch (e) {
            setRenderState({
                kind: "error",
                message: "Network error reaching the dashboard.",
                detail: (e as Error).message,
            });
            return;
        }

        if (!res.ok) {
            let body: RenderApiError | null = null;
            try {
                body = (await res.json()) as RenderApiError;
            } catch {
                /* */
            }
            const detail = [
                body?.hint,
                body?.detail,
                body?.details?.map((d) => `${d.field}: ${d.message}`).join("; "),
            ]
                .filter(Boolean)
                .join(" — ");
            setRenderState({
                kind: "error",
                message: body?.error ?? `Render failed (HTTP ${res.status})`,
                detail: detail || undefined,
            });
            return;
        }

        let blob: Blob;
        try {
            blob = await res.blob();
        } catch (e) {
            setRenderState({
                kind: "error",
                message: "Could not read render response as PDF.",
                detail: (e as Error).message,
            });
            return;
        }

        const blobUrl = URL.createObjectURL(blob);
        const wallHeader = res.headers.get("X-Render-Wall-Ms");
        const serverWallMs = wallHeader ? Number.parseInt(wallHeader, 10) : null;
        const applied = (res.headers.get("X-Render-Applied-Overrides") ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        const skipped = (res.headers.get("X-Render-Skipped-Overrides") ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        setRenderState({
            kind: "success",
            blobUrl,
            bytes: blob.size,
            serverWallMs: Number.isFinite(serverWallMs) ? serverWallMs : null,
            appliedOverrides: applied,
            skippedOverrides: skipped,
        });
        setDirtySinceRender(false);
    }

    // Recovery: no template / not enough comps
    if (!template) {
        return (
            <Card className="space-y-3 p-6">
                <p className="text-sm">
                    No template selected. Build flow starts at template
                    selection.
                </p>
                <Link
                    href="/build/template"
                    className="inline-flex h-9 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background hover:bg-foreground/90"
                >
                    Go to template selection
                </Link>
            </Card>
        );
    }
    if (comps.length === 0) {
        return (
            <Card className="space-y-3 p-6">
                <p className="text-sm">
                    No comps selected. Pick {template.tileCount} comps to
                    continue.
                </p>
                <Link
                    href="/build/comps"
                    className="inline-flex h-9 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background hover:bg-foreground/90"
                >
                    Go to comp selection
                </Link>
            </Card>
        );
    }

    return (
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* LEFT: edit */}
            <div className="space-y-6">
                <header className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            Edit & render
                        </h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {template.label} · {tileCount} tiles
                        </p>
                    </div>
                    <Link
                        href="/build/comps"
                        className="text-sm underline text-muted-foreground hover:text-foreground"
                    >
                        Change comps
                    </Link>
                </header>

                <Separator />

                {/* Page-level fields */}
                <section aria-labelledby="page-fields-heading" className="space-y-3">
                    <h2
                        id="page-fields-heading"
                        className="text-sm font-medium text-foreground/80"
                    >
                        Page-level fields
                    </h2>
                    {pageFieldsLoading ? (
                        <div className="grid gap-3" aria-busy="true" aria-label="Loading current values from the template">
                            {[0, 1].map((i) => (
                                <div key={i} className="grid gap-1.5">
                                    <div className="h-4 w-20 animate-pulse rounded bg-muted" />
                                    <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
                                </div>
                            ))}
                        </div>
                    ) : pageFieldsError ? (
                        <Card
                            role="alert"
                            className="border-destructive/40 bg-destructive/5 p-3"
                        >
                            <p className="text-sm font-medium text-destructive">
                                Couldn&apos;t pre-populate page fields
                            </p>
                            <p className="mt-1 text-xs text-destructive/80">
                                {pageFieldsError}
                            </p>
                        </Card>
                    ) : pageFields && pageFields.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            This template has no editable page fields.
                        </p>
                    ) : (
                        <div className="grid gap-3">
                            {pageFields?.map((f) => (
                                <div key={f.field} className="grid gap-1.5">
                                    <Label htmlFor={`pf-${f.field}`}>
                                        {f.label}
                                        {f.missing ? (
                                            <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
                                                (frame {f.frame} missing in template)
                                            </span>
                                        ) : null}
                                    </Label>
                                    <Input
                                        id={`pf-${f.field}`}
                                        value={valueFor(f.field)}
                                        onChange={(e) =>
                                            handleSetPageOverride(f.field, e.target.value)
                                        }
                                        placeholder={f.frame}
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <Separator />

                {/* Tile arrangement */}
                <section aria-labelledby="tile-grid-heading" className="space-y-3">
                    <div className="flex items-baseline justify-between">
                        <h2
                            id="tile-grid-heading"
                            className="text-sm font-medium text-foreground/80"
                        >
                            Tile arrangement
                        </h2>
                        <p className="text-xs text-muted-foreground tabular-nums">
                            {comps.length} / {tileCount} tiles · drag to reorder
                        </p>
                    </div>
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={onDragEnd}
                    >
                        <SortableContext
                            items={comps.map((c) => c.id)}
                            strategy={rectSortingStrategy}
                        >
                            <ul className={`grid gap-3 ${gridColsClass(template.gridCols ?? heuristicCols(tileCount))}`}>
                                {comps.map((c, i) => (
                                    <li key={c.id}>
                                        <SortableTileCard
                                            comp={c}
                                            index={i}
                                            onRemove={onRemoveTile}
                                            showStatus={
                                                template.tileFieldNames?.includes(
                                                    "status"
                                                ) ?? false
                                            }
                                            showPrice={
                                                template.tileFieldNames?.includes(
                                                    "price"
                                                ) ?? false
                                            }
                                        />
                                    </li>
                                ))}
                            </ul>
                        </SortableContext>
                    </DndContext>
                    {comps.length < tileCount ? (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                            {tileCount - comps.length} more comp
                            {tileCount - comps.length === 1 ? "" : "s"} needed
                            before you can render.{" "}
                            <Link href="/build/comps" className="underline">
                                Add from the comps stage
                            </Link>
                            .
                        </p>
                    ) : null}
                </section>

                <div className="pt-2">
                    <Button
                        size="lg"
                        disabled={!canRender}
                        onClick={onRender}
                        aria-busy={renderState.kind === "loading"}
                    >
                        {renderState.kind === "loading"
                            ? "Rendering…"
                            : renderState.kind === "success"
                                ? "Re-render"
                                : "Render"}
                    </Button>
                    <p
                        className={`mt-2 text-xs ${
                            renderState.kind === "success" && dirtySinceRender
                                ? "font-medium text-amber-700 dark:text-amber-400"
                                : "text-muted-foreground"
                        }`}
                    >
                        {renderState.kind === "loading"
                            ? "Calling the bridge — usually 2-10 seconds."
                            : !canRender
                                ? comps.length !== tileCount
                                    ? `Need exactly ${tileCount} tiles.`
                                    : !allRequiredOverridesNonEmpty
                                        ? "Fill in every page field."
                                        : "Loading…"
                                : renderState.kind === "success"
                                    ? dirtySinceRender
                                        ? "You've made changes — re-render to see them."
                                        : "Preview is up to date."
                                    : "Ready to render."}
                    </p>
                </div>
            </div>

            {/* RIGHT: preview */}
            <aside className="lg:sticky lg:top-6 lg:self-start">
                {renderState.kind === "success" ? (
                    <div className="space-y-3">
                        <div className="flex items-baseline justify-between">
                            <h2 className="text-sm font-medium text-foreground/80">
                                Preview
                            </h2>
                            <p className="text-xs text-muted-foreground tabular-nums">
                                {(renderState.bytes / 1024).toFixed(1)} KB
                                {renderState.serverWallMs !== null
                                    ? ` · ${renderState.serverWallMs} ms server`
                                    : ""}
                            </p>
                        </div>
                        <div className="overflow-hidden rounded-md border bg-muted">
                            <embed
                                src={renderState.blobUrl}
                                type="application/pdf"
                                className="block h-[680px] w-full"
                                aria-label="Rendered team-sheet PDF"
                            />
                        </div>
                        <div>
                            <a
                                href={renderState.blobUrl}
                                download="team-sheet.pdf"
                                className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
                            >
                                Download PDF
                            </a>
                        </div>
                        {renderState.skippedOverrides.length > 0 ? (
                            <p className="text-xs text-amber-700 dark:text-amber-400">
                                Note: page-field frame{renderState.skippedOverrides.length === 1 ? "" : "s"}{" "}
                                <code className="rounded bg-amber-500/10 px-1 py-0.5">
                                    {renderState.skippedOverrides.join(", ")}
                                </code>{" "}
                                not found in the template — those override
                                {renderState.skippedOverrides.length === 1 ? " was" : "s were"} skipped.
                                Add the named frame
                                {renderState.skippedOverrides.length === 1 ? "" : "s"} in InDesign or remove the
                                input{renderState.skippedOverrides.length === 1 ? "" : "s"} from the manifest.
                            </p>
                        ) : null}
                    </div>
                ) : renderState.kind === "error" ? (
                    <Card
                        role="alert"
                        className="border-destructive/40 bg-destructive/5 p-6"
                    >
                        <p className="text-sm font-medium text-destructive">
                            {renderState.message}
                        </p>
                        {renderState.detail ? (
                            <p className="mt-1 text-xs text-destructive/80">
                                {renderState.detail}
                            </p>
                        ) : null}
                        <p className="mt-3 text-xs text-muted-foreground">
                            Fix the issue, then click Render again.
                        </p>
                    </Card>
                ) : (
                    <div className="flex h-[680px] items-center justify-center rounded-md bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        <p className="text-sm">
                            {renderState.kind === "loading"
                                ? "Rendering…"
                                : "Hit Render to preview your team sheet."}
                        </p>
                    </div>
                )}
            </aside>
        </section>
    );
}
