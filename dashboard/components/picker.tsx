"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { type Comp, formatSfAc } from "@/lib/format";

interface PickerProps {
    comps: Comp[];
}

const TARGET_COUNT = 6;

function imageSrc(filename: string): string {
    return `/api/images/${encodeURIComponent(filename)}`;
}

function compMatchesQuery(c: Comp, q: string): boolean {
    if (q.length === 0) return true;
    const needle = q.toLowerCase();
    return (
        c.address.toLowerCase().includes(needle) ||
        c.city.toLowerCase().includes(needle) ||
        c.state.toLowerCase().includes(needle)
    );
}

export default function Picker({ comps }: PickerProps) {
    const [query, setQuery] = useState("");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);

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

    function add(id: string) {
        if (selectedSet.has(id)) return;
        if (selectedIds.length >= TARGET_COUNT) return;
        setSelectedIds((prev) => [...prev, id]);
    }
    function remove(id: string) {
        setSelectedIds((prev) => prev.filter((x) => x !== id));
    }

    function onRender() {
        // Stage 4.3 stub. Wired to /api/render in Stage 4.4.
        console.log("render", selectedIds);
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
                                    <Card className="flex flex-row items-center gap-3 p-3">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={imageSrc(c.image_filename)}
                                            alt=""
                                            loading="lazy"
                                            className="h-14 w-14 rounded-md object-cover bg-muted shrink-0"
                                        />
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
                    disabled={!canRender}
                    onClick={onRender}
                >
                    Render
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                    {canRender
                        ? "Ready to render."
                        : `Select exactly ${TARGET_COUNT} comps to enable.`}
                </p>
            </div>
        </div>
    );
}
