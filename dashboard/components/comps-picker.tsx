"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
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
import {
    type Comp,
    formatPriceLine,
    formatSfAc,
    formatStatusBadge,
} from "@/lib/format";

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

// Available-comps grid is 2 cols × 10 rows = 20 per page. Tried 3
// cols briefly but card content (address + city/state · ±SF | ±AC)
// was getting truncated; 2 cols keeps each card's text readable.
// Filter and sort changes reset the user back to page 1 since the
// previous offset rarely makes sense in a re-shaped result set.
const PAGE_SIZE = 20;

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
    const [page, setPage] = useState(0);

    // Whenever the filter/sort state changes, snap back to page 1 so
    // the user sees the top of the new result set instead of an
    // ambient offset that may now be empty.
    useEffect(() => {
        setPage(0);
    }, [query, submarket, statuses, dateRange, sortBy]);

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

    // Mirror the per-template field surfacing from the edit-stage tile
    // cards: a comp's price line and status badge only appear on the
    // picker card when the selected template declares those fields.
    // Same formatters (`formatPriceLine`, `formatStatusBadge`) so the
    // picker and edit pages stay character-identical.
    const showStatus = template?.tileFieldNames?.includes("status") ?? false;
    const showPrice = template?.tileFieldNames?.includes("price") ?? false;

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    // Clamp page in case the active filters shrank the result set
    // below the previous page index. (Reset-on-filter-change covers the
    // common case; this guards the edge where state updates race.)
    const safePage = Math.min(page, totalPages - 1);
    const pageStart = safePage * PAGE_SIZE;
    const pageEnd = Math.min(pageStart + PAGE_SIZE, filtered.length);
    const pageItems = filtered.slice(pageStart, pageEnd);

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
                    className={buttonVariants({ size: "lg" })}
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
                                <SelectValue>
                                    {(v) =>
                                        v === ALL || !v
                                            ? "All submarkets"
                                            : v === NULL_KEY
                                                ? NULL_LABEL
                                                : (v as string)
                                    }
                                </SelectValue>
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
                                <SelectValue>
                                    {(v) =>
                                        DATE_RANGE_OPTIONS.find((o) => o.key === v)
                                            ?.label ?? "All time"
                                    }
                                </SelectValue>
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
                                <SelectValue>
                                    {(v) =>
                                        SORT_OPTIONS.find((o) => o.key === v)?.label ??
                                        "Sale date (newest)"
                                    }
                                </SelectValue>
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
                            className="text-xs underline text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
                        >
                            Clear filters
                        </button>
                    ) : null}
                </div>

                <div
                    role="group"
                    aria-label="Filter by status"
                    className="flex flex-wrap items-center gap-2"
                >
                    <span className="text-xs font-medium text-foreground/80">Status</span>
                    {statusOptions.map((opt) => {
                        const active = statuses.has(opt);
                        return (
                            <button
                                key={opt}
                                type="button"
                                onClick={() => toggleStatus(opt)}
                                aria-pressed={active}
                                className={`rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
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
                    {filtered.length === 0
                        ? `0 of ${comps.length} shown`
                        : `Showing ${pageStart + 1}–${pageEnd} of ${filtered.length}${
                              filtered.length !== comps.length
                                  ? ` (filtered from ${comps.length})`
                                  : ""
                          }`}
                </p>

                <ul className="grid gap-3 md:grid-cols-2">
                    {filtered.length === 0 ? (
                        <li className="text-sm text-muted-foreground md:col-span-2">
                            No comps match the current filters.
                        </li>
                    ) : (
                        pageItems.map((c) => {
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
                                        {/*
                                          Image is wrapped so the Card's
                                          `has-[>img:first-child]:pt-0` rule
                                          (intended for hero/image-top cards)
                                          doesn't collapse the top padding
                                          on this row layout.
                                        */}
                                        <div className="shrink-0">
                                            {c.image_url ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    src={c.image_url}
                                                    alt=""
                                                    loading="lazy"
                                                    width={60}
                                                    height={60}
                                                    className="h-[60px] w-[60px] rounded-md object-cover bg-muted block"
                                                />
                                            ) : (
                                                <div
                                                    aria-label="No image"
                                                    className="h-[60px] w-[60px] rounded-md bg-muted"
                                                />
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium">
                                                {c.address}
                                            </p>
                                            <p className="truncate text-xs text-muted-foreground">
                                                {c.city}, {c.state} · {formatSfAc(c.building_sf, c.land_area)}
                                            </p>
                                            {showStatus || showPrice ? (
                                                <div className="mt-1 flex items-center gap-1.5 min-w-0">
                                                    {showStatus ? (
                                                        <span className="shrink-0 rounded-md border border-border bg-muted px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-foreground/70">
                                                            {formatStatusBadge(c.status) || "—"}
                                                        </span>
                                                    ) : null}
                                                    {showPrice ? (
                                                        <span className="truncate text-xs text-muted-foreground">
                                                            {formatPriceLine({
                                                                sale_price: c.sale_price,
                                                                base_rent_total: c.base_rent_total,
                                                                lease_format: c.lease_format,
                                                            })}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            ) : null}
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

                {totalPages > 1 ? (
                    <div className="flex items-center justify-between gap-3 pt-1">
                        <p
                            className="text-xs text-muted-foreground tabular-nums"
                            aria-live="polite"
                        >
                            Page {safePage + 1} of {totalPages}
                        </p>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={safePage === 0}
                                onClick={() => setPage((p) => Math.max(0, p - 1))}
                                aria-label="Previous page"
                            >
                                Previous
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={safePage >= totalPages - 1}
                                onClick={() =>
                                    setPage((p) => Math.min(totalPages - 1, p + 1))
                                }
                                aria-label="Next page"
                            >
                                Next
                            </Button>
                        </div>
                    </div>
                ) : null}
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
