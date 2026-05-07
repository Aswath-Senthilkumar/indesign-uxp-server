"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useBuildState } from "@/lib/build-state";
import { type Comp, formatSfAc } from "@/lib/format";

interface CompsPickerProps {
    comps: Comp[];
}

// Stage 6: comps now carry a fully-qualified Supabase storage URL
// (or null) instead of a local mock-data filename. Track C will add
// a richer missing-image affordance; for Track A we just render an
// empty muted box when image_url is null so the picker stays usable.

function compMatchesQuery(c: Comp, q: string): boolean {
    if (q.length === 0) return true;
    const needle = q.toLowerCase();
    return (
        c.address.toLowerCase().includes(needle) ||
        c.city.toLowerCase().includes(needle) ||
        c.state.toLowerCase().includes(needle)
    );
}

export default function CompsPicker({ comps }: CompsPickerProps) {
    const router = useRouter();
    const { template, comps: selected, setComps } = useBuildState();

    const [query, setQuery] = useState("");

    // Compute these unconditionally (hooks-order rule). When template is
    // null, we ignore them and render the recovery card.
    const filtered = useMemo(
        () => comps.filter((c) => compMatchesQuery(c, query)),
        [comps, query]
    );
    const selectedSet = useMemo(
        () => new Set(selected.map((c) => c.id)),
        [selected]
    );

    // Recovery state when the user lands here without a template — e.g.
    // refreshed the page or pasted a deep link.
    if (!template) {
        return (
            <Card className="space-y-3 p-6">
                <p className="text-sm">
                    No template selected. The build flow starts at template
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

    const targetCount = template.tileCount;
    const canContinue = selected.length === targetCount;

    function add(c: Comp) {
        if (selectedSet.has(c.id)) return;
        if (selected.length >= targetCount) return;
        setComps([...selected, c]);
    }
    function remove(id: string) {
        setComps(selected.filter((c) => c.id !== id));
    }

    function onContinue() {
        if (!canContinue) return;
        router.push("/build/edit");
    }

    return (
        <section className="space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="truncate text-2xl font-semibold tracking-tight">
                        Pick comps
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Template: <span className="font-medium text-foreground">{template.label}</span>
                        {" · "}
                        {targetCount} tiles
                    </p>
                </div>
                <Link
                    href="/build/template"
                    className="text-sm underline text-muted-foreground hover:text-foreground"
                >
                    Change template
                </Link>
            </header>

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
                            No comps match &ldquo;{query}&rdquo;.
                        </li>
                    ) : (
                        filtered.map((c) => {
                            const isSelected = selectedSet.has(c.id);
                            const atCap =
                                !isSelected && selected.length >= targetCount;
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
                                        <div className="min-w-0 flex-1">
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
                                            onClick={() => (isSelected ? remove(c.id) : add(c))}
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
                        {selected.length} / {targetCount}
                    </p>
                </div>
                {selected.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                        Nothing selected yet — add comps from the list above.
                    </p>
                ) : (
                    <ol className="mt-3 grid gap-2">
                        {selected.map((c, i) => (
                            <li key={c.id}>
                                <Card className="flex flex-row items-center gap-3 p-3">
                                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-xs font-semibold tabular-nums">
                                        {i + 1}
                                    </span>
                                    <div className="min-w-0 flex-1">
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
                <Button size="lg" disabled={!canContinue} onClick={onContinue}>
                    Continue to Edit
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                    {canContinue
                        ? "Ready to edit and render."
                        : `Select exactly ${targetCount} comps to continue.`}
                </p>
            </div>
        </section>
    );
}
