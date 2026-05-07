"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useBuildState } from "@/lib/build-state";
import { type Comp, formatSfAc } from "@/lib/format";

interface CompsPickerProps {
    comps: Comp[];
}

// Stage 6: comps now carry a fully-qualified Supabase storage URL
// (or null) instead of a local mock-data filename. Track C will add
// a richer missing-image affordance; for Track A we just render an
// empty muted box when image_url is null so the picker stays usable.

const ALL = "__all__";
const NULL_KEY = "__null__";
const NULL_LABEL = "(none)";

type DateRangeKey = "all" | "30d" | "90d" | "6m" | "12m";
type SortKey = "sale_date" | "sale_price" | "building_sf";

const DATE_RANGE_OPTIONS: Array<{ key: DateRangeKey; label: string }> = [
    { key: "all", label: "All time" },
    { key: "30d", label: "Last 30 days" },
    { key: "90d", label: "Last 90 days" },
    { key: "6m", label: "Last 6 months" },
    { key: "12m", label: "Last 12 months" },
];

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
    { key: "sale_date", label: "Sale date (newest)" },
    { key: "sale_price", label: "Sale price (highest)" },
    { key: "building_sf", label: "Building SF (largest)" },
];

function dateRangeMs(r: DateRangeKey): number | null {
    switch (r) {
        case "30d":
            return 30 * 24 * 60 * 60 * 1000;
        case "90d":
            return 90 * 24 * 60 * 60 * 1000;
        case "6m":
            return 183 * 24 * 60 * 60 * 1000;
        case "12m":
            return 365 * 24 * 60 * 60 * 1000;
        case "all":
            return null;
    }
}

function compMatchesQuery(c: Comp, q: string): boolean {
    if (q.length === 0) return true;
    const needle = q.toLowerCase();
    return (
        c.address.toLowerCase().includes(needle) ||
        c.city.toLowerCase().includes(needle) ||
        (c.property_name?.toLowerCase().includes(needle) ?? false)
    );
}

// Sort comparators put nulls last regardless of direction so the user
// always sees the meaningful values up top.
function compareBy(key: SortKey): (a: Comp, b: Comp) => number {
    switch (key) {
        case "sale_date":
            return (a, b) => {
                if (a.sale_date && b.sale_date) {
                    return b.sale_date.localeCompare(a.sale_date);
                }
                if (a.sale_date) return -1;
                if (b.sale_date) return 1;
                return 0;
            };
        case "sale_price":
            return (a, b) => {
                if (a.sale_price !== null && b.sale_price !== null) {
                    return b.sale_price - a.sale_price;
                }
                if (a.sale_price !== null) return -1;
                if (b.sale_price !== null) return 1;
                return 0;
            };
        case "building_sf":
            return (a, b) => b.building_sf - a.building_sf;
    }
}

export default function CompsPicker({ comps }: CompsPickerProps) {
    const router = useRouter();
    const { template, comps: selected, setComps } = useBuildState();

    const [query, setQuery] = useState("");
    const [submarket, setSubmarket] = useState<string>(ALL);
    const [statuses, setStatuses] = useState<Set<string>>(new Set());
    const [dateRange, setDateRange] = useState<DateRangeKey>("all");
    const [sortBy, setSortBy] = useState<SortKey>("sale_date");

    // Hooks-order rule: compute everything unconditionally before the
    // template-recovery early return.
    const submarketOptions = useMemo(() => {
        const set = new Set<string>();
        for (const c of comps) set.add(c.submarket_cluster ?? NULL_KEY);
        return Array.from(set).sort((a, b) => {
            if (a === NULL_KEY) return 1;
            if (b === NULL_KEY) return -1;
            return a.localeCompare(b);
        });
    }, [comps]);

    const statusOptions = useMemo(() => {
        const set = new Set<string>();
        for (const c of comps) set.add(c.status ?? NULL_KEY);
        return Array.from(set).sort((a, b) => {
            if (a === NULL_KEY) return 1;
            if (b === NULL_KEY) return -1;
            return a.localeCompare(b);
        });
    }, [comps]);

    const filtered = useMemo(() => {
        const now = Date.now();
        const rangeMs = dateRangeMs(dateRange);
        const out = comps.filter((c) => {
            if (!compMatchesQuery(c, query)) return false;
            if (submarket !== ALL) {
                const v = c.submarket_cluster ?? NULL_KEY;
                if (v !== submarket) return false;
            }
            if (statuses.size > 0) {
                const v = c.status ?? NULL_KEY;
                if (!statuses.has(v)) return false;
            }
            if (rangeMs !== null) {
                if (!c.sale_date) return false;
                const t = Date.parse(c.sale_date);
                if (Number.isNaN(t)) return false;
                if (now - t > rangeMs) return false;
            }
            return true;
        });
        out.sort(compareBy(sortBy));
        return out;
    }, [comps, query, submarket, statuses, dateRange, sortBy]);

    const selectedSet = useMemo(
        () => new Set(selected.map((c) => c.id)),
        [selected]
    );

    const hasActiveFilters =
        query.length > 0 ||
        submarket !== ALL ||
        statuses.size > 0 ||
        dateRange !== "all" ||
        sortBy !== "sale_date";

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

    function toggleStatus(s: string) {
        setStatuses((prev) => {
            const next = new Set(prev);
            if (next.has(s)) next.delete(s);
            else next.add(s);
            return next;
        });
    }

    function clearFilters() {
        setQuery("");
        setSubmarket(ALL);
        setStatuses(new Set());
        setDateRange("all");
        setSortBy("sale_date");
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

            <section className="space-y-3">
                <div>
                    <h2 className="text-sm font-medium text-foreground/80">
                        Available comps
                    </h2>
                    <Input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search by address, city, or property name…"
                        className="mt-2 w-full"
                        aria-label="Search comps"
                    />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/80">Submarket</span>
                        <Select
                            value={submarket}
                            onValueChange={(v) => {
                                if (v !== null) setSubmarket(v);
                            }}
                        >
                            <SelectTrigger size="sm" className="min-w-[180px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL}>All submarkets</SelectItem>
                                {submarketOptions.map((opt) => (
                                    <SelectItem key={opt} value={opt}>
                                        {opt === NULL_KEY ? NULL_LABEL : opt}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </label>

                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/80">Sale date</span>
                        <Select
                            value={dateRange}
                            onValueChange={(v) => {
                                if (v !== null) setDateRange(v as DateRangeKey);
                            }}
                        >
                            <SelectTrigger size="sm" className="min-w-[150px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {DATE_RANGE_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.key} value={opt.key}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </label>

                    <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/80">Sort by</span>
                        <Select
                            value={sortBy}
                            onValueChange={(v) => {
                                if (v !== null) setSortBy(v as SortKey);
                            }}
                        >
                            <SelectTrigger size="sm" className="min-w-[180px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {SORT_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.key} value={opt.key}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </label>

                    {hasActiveFilters ? (
                        <button
                            type="button"
                            onClick={clearFilters}
                            className="text-xs underline text-muted-foreground hover:text-foreground"
                        >
                            Clear filters
                        </button>
                    ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-foreground/80">Status</span>
                    {statusOptions.map((opt) => {
                        const active = statuses.has(opt);
                        return (
                            <button
                                key={opt}
                                type="button"
                                onClick={() => toggleStatus(opt)}
                                aria-pressed={active}
                                className={`rounded-md border px-2 py-0.5 text-xs font-medium transition-colors ${
                                    active
                                        ? "border-foreground bg-foreground text-background"
                                        : "border-border bg-transparent text-foreground/80 hover:bg-muted"
                                }`}
                            >
                                {opt === NULL_KEY ? NULL_LABEL : opt}
                            </button>
                        );
                    })}
                </div>

                <p className="text-sm text-muted-foreground tabular-nums">
                    {filtered.length} of {comps.length} shown
                </p>

                <ul className="grid gap-2">
                    {filtered.length === 0 ? (
                        <li className="text-sm text-muted-foreground">
                            No comps match the current filters.
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
