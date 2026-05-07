"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { type Comp, formatSfAc } from "@/lib/format";

interface PickerProps {
    comps: Comp[];
}

const TARGET_COUNT = 6;

// Stage 6: comps now carry a fully-qualified Supabase storage URL
// (or null) instead of a local mock-data filename — see comps-picker.tsx
// for the same change in the primary build flow.

function compMatchesQuery(c: Comp, q: string): boolean {
    if (q.length === 0) return true;
    const needle = q.toLowerCase();
    return (
        c.address.toLowerCase().includes(needle) ||
        c.city.toLowerCase().includes(needle) ||
        c.state.toLowerCase().includes(needle)
    );
}

type RenderState =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "success"; blobUrl: string; bytes: number; serverWallMs: number | null }
    | { kind: "error"; message: string; detail?: string };

interface RenderApiError {
    error: string;
    detail?: string;
    hint?: string;
    details?: Array<{ field: string; message: string }>;
}

export default function Picker({ comps }: PickerProps) {
    const [query, setQuery] = useState("");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [renderState, setRenderState] = useState<RenderState>({ kind: "idle" });

    // Revoke any blob URL on unmount or when a new render replaces it.
    useEffect(() => {
        const url = renderState.kind === "success" ? renderState.blobUrl : null;
        return () => {
            if (url) URL.revokeObjectURL(url);
        };
    }, [renderState]);

    const filtered = useMemo(
        () => comps.filter((c) => compMatchesQuery(c, query)),
        [comps, query]
    );

    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    const selectedComps = useMemo(
        () => selectedIds.map((id) => comps.find((c) => c.id === id)).filter((c): c is Comp => Boolean(c)),
        [selectedIds, comps]
    );

    const canRender = selectedIds.length === TARGET_COUNT;
    const isLoading = renderState.kind === "loading";

    function add(id: string) {
        if (selectedSet.has(id)) return;
        if (selectedIds.length >= TARGET_COUNT) return;
        setSelectedIds((prev) => [...prev, id]);
    }
    function remove(id: string) {
        setSelectedIds((prev) => prev.filter((x) => x !== id));
    }

    async function onRender() {
        if (!canRender || isLoading) return;
        setRenderState({ kind: "loading" });

        // Legacy picker: hardcoded template_id + tile_count for the
        // sample template. The real flow at /build/* gets these from
        // the manifest + introspection.
        const payload = {
            template_id: "recently-leased-ios",
            tile_count: 6,
            comps: selectedComps,
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
                /* not JSON; leave body null */
            }
            const message =
                body?.error ?? `Render failed (HTTP ${res.status})`;
            const detail = [
                body?.hint,
                body?.detail,
                body?.details?.map((d) => `${d.field}: ${d.message}`).join("; "),
            ]
                .filter(Boolean)
                .join(" — ");
            setRenderState({
                kind: "error",
                message,
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
                message: "Render returned a response we couldn't read as a PDF.",
                detail: (e as Error).message,
            });
            return;
        }

        const blobUrl = URL.createObjectURL(blob);
        const wallHeader = res.headers.get("X-Render-Wall-Ms");
        const serverWallMs = wallHeader ? Number.parseInt(wallHeader, 10) : null;
        setRenderState({
            kind: "success",
            blobUrl,
            bytes: blob.size,
            serverWallMs: Number.isFinite(serverWallMs) ? serverWallMs : null,
        });
    }

    return (
        <div className="space-y-6">
            <section>
                <h2 className="text-sm font-medium text-foreground/80">
                    Template
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    6-tile sample (template-v2-test)
                </p>
            </section>

            <Separator />

            <section>
                <div className="flex items-end justify-between gap-4">
                    <div className="flex-1">
                        <h2 className="text-sm font-medium text-foreground/80">
                            Available comps
                        </h2>
                        <Input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Filter by address, city, or state…"
                            className="mt-2 max-w-md"
                            aria-label="Filter comps"
                        />
                    </div>
                    <p className="text-sm text-muted-foreground tabular-nums">
                        {filtered.length} of {comps.length}
                    </p>
                </div>

                <ul className="mt-4 grid gap-2">
                    {filtered.length === 0 ? (
                        <li className="text-sm text-muted-foreground">
                            No comps match “{query}”.
                        </li>
                    ) : (
                        filtered.map((c) => {
                            const isSelected = selectedSet.has(c.id);
                            const atCap =
                                !isSelected && selectedIds.length >= TARGET_COUNT;
                            return (
                                <li key={c.id}>
                                    <Card
                                        className={`flex flex-row items-center gap-3 p-3 transition-colors ${
                                            isSelected
                                                ? "border-foreground/20 bg-muted/40"
                                                : atCap
                                                    ? "opacity-60"
                                                    : "hover:bg-muted/30"
                                        }`}
                                    >
                                        {c.image_url ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={c.image_url}
                                                alt=""
                                                loading="lazy"
                                                width={60}
                                                height={60}
                                                className="h-[60px] w-[60px] rounded-md object-cover bg-muted shrink-0"
                                            />
                                        ) : (
                                            <div
                                                aria-label="No image"
                                                className="h-[60px] w-[60px] shrink-0 rounded-md bg-muted"
                                            />
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="truncate text-sm font-medium">
                                                {c.address}
                                            </p>
                                            <p className="truncate text-xs text-muted-foreground">
                                                {c.city}, {c.state} · {formatSfAc(c.building_sf, c.land_area)}
                                            </p>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant={isSelected ? "secondary" : "default"}
                                            onClick={() => (isSelected ? remove(c.id) : add(c.id))}
                                            disabled={atCap}
                                        >
                                            {isSelected ? "Selected" : atCap ? "Full" : "Add"}
                                        </Button>
                                    </Card>
                                </li>
                            );
                        })
                    )}
                </ul>
            </section>

            <Separator />

            <section>
                <div className="flex items-baseline justify-between">
                    <h2 className="text-sm font-medium text-foreground/80">
                        Selected
                    </h2>
                    <p className="text-sm text-muted-foreground tabular-nums">
                        {selectedIds.length} / {TARGET_COUNT}
                    </p>
                </div>
                {selectedComps.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                        Nothing selected yet — add comps from the list above.
                    </p>
                ) : (
                    <ol className="mt-3 grid gap-2">
                        {selectedComps.map((c, i) => (
                            <li key={c.id}>
                                <Card className="flex flex-row items-center gap-3 p-3">
                                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-xs font-semibold tabular-nums">
                                        {i + 1}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <p className="truncate text-sm font-medium">
                                            {c.address}
                                        </p>
                                        <p className="truncate text-xs text-muted-foreground">
                                            {c.city}, {c.state}
                                        </p>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => remove(c.id)}
                                        aria-label={`Remove ${c.address}`}
                                    >
                                        Remove
                                    </Button>
                                </Card>
                            </li>
                        ))}
                    </ol>
                )}
            </section>

            <div className="pt-2">
                <Button
                    size="lg"
                    disabled={!canRender || isLoading}
                    onClick={onRender}
                    aria-busy={isLoading}
                >
                    {isLoading ? "Rendering…" : "Render"}
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                    {isLoading
                        ? "Calling the bridge — usually 2-10 seconds."
                        : canRender
                            ? "Ready to render."
                            : `Select exactly ${TARGET_COUNT} comps to enable.`}
                </p>
            </div>

            {renderState.kind === "error" ? (
                <Card
                    role="alert"
                    className="border-destructive/40 bg-destructive/5 p-4"
                >
                    <p className="text-sm font-medium text-destructive">
                        {renderState.message}
                    </p>
                    {renderState.detail ? (
                        <p className="mt-1 text-xs text-destructive/80">
                            {renderState.detail}
                        </p>
                    ) : null}
                </Card>
            ) : null}

            {renderState.kind === "success" ? (
                <section aria-label="Rendered PDF preview">
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
                    <div className="mt-3 overflow-hidden rounded-md border bg-muted">
                        <embed
                            src={renderState.blobUrl}
                            type="application/pdf"
                            className="block w-full h-[600px]"
                            aria-label="Rendered team-sheet PDF"
                        />
                    </div>
                    <div className="mt-3">
                        <a
                            href={renderState.blobUrl}
                            download="team-sheet.pdf"
                            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
                        >
                            Download PDF
                        </a>
                    </div>
                </section>
            ) : null}
        </div>
    );
}
