"use client";

import { useMemo, useState } from "react";
import type { Comp } from "@/lib/format";
import { formatSfAc } from "@/lib/format";

interface BovCompPickerProps {
    comps:    Comp[];
    onSelect: (comp: Comp) => void;
    onClose:  () => void;
}

function compMatchesQuery(c: Comp, q: string): boolean {
    if (!q) return true;
    const n = q.toLowerCase();
    return (
        c.address.toLowerCase().includes(n) ||
        c.city.toLowerCase().includes(n) ||
        (c.property_name?.toLowerCase().includes(n) ?? false)
    );
}

export default function BovCompPicker({ comps, onSelect, onClose }: BovCompPickerProps) {
    const [query, setQuery] = useState("");

    const filtered = useMemo(
        () => comps.filter(c => compMatchesQuery(c, query)),
        [comps, query]
    );

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="flex flex-col bg-background rounded-lg border border-foreground/20 w-[680px] max-h-[80vh] overflow-hidden shadow-xl">

                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/10 shrink-0">
                    <h2 className="text-sm font-semibold">Pick Comp</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-sm text-muted-foreground hover:text-foreground leading-none"
                    >
                        ✕
                    </button>
                </div>

                {/* Search */}
                <div className="px-4 py-2 border-b border-foreground/10 shrink-0">
                    <input
                        autoFocus
                        type="text"
                        placeholder="Search by address, city, or property name…"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        className="w-full rounded border border-foreground/20 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
                    />
                    {filtered.length > 0 && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                            {filtered.length} comp{filtered.length !== 1 ? "s" : ""}
                        </p>
                    )}
                </div>

                {/* Comp grid */}
                <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 gap-2">
                    {filtered.map(comp => (
                        <button
                            key={comp.id}
                            type="button"
                            onClick={() => { onSelect(comp); onClose(); }}
                            className="flex gap-2.5 rounded border border-foreground/10 p-2 text-left hover:bg-muted/30 transition-colors"
                        >
                            {comp.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={comp.image_url}
                                    alt=""
                                    className="h-16 w-20 shrink-0 rounded object-cover"
                                />
                            ) : (
                                <div className="h-16 w-20 shrink-0 rounded bg-muted/40" />
                            )}
                            <div className="flex flex-col gap-0.5 min-w-0 justify-center">
                                <p className="text-xs font-medium leading-snug line-clamp-2">{comp.address}</p>
                                <p className="text-[11px] text-muted-foreground">{comp.city}, {comp.state}</p>
                                <p className="text-[11px] text-muted-foreground">
                                    {formatSfAc(comp.building_sf, comp.land_area)}
                                </p>
                                {comp.status && (
                                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
                                        {comp.status}
                                    </span>
                                )}
                            </div>
                        </button>
                    ))}

                    {filtered.length === 0 && (
                        <p className="col-span-2 text-center text-sm text-muted-foreground py-10">
                            {query ? `No comps match "${query}"` : "No comps available"}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
