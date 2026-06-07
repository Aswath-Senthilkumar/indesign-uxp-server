"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useBovState } from "@/lib/bov-state";
import { useMergedPdf } from "@/lib/use-merged-pdf";
import type { Comp } from "@/lib/format";
import { formatSfAc } from "@/lib/format";
import BovCompPicker from "@/components/bov-comp-picker";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TileFields {
    compId:          string | null;
    addressStatus:   string;
    sfOnAc:          string;
    imageFile:       File | null;    // manually uploaded — takes priority
    imageName:       string;
    imagePreviewUrl: string | null;  // blob URL or Supabase URL (display only)
    imageUrl:        string | null;  // Supabase public URL for server staging
}

interface HighlightRow {
    id:       string;
    key:      string;
    value:    string;
    isCustom: boolean;
}

interface Section1Fields {
    tiles:                        TileFields[];
    similarTransactionsAddress:   string;
    clientMention:                string;
    highlights:                   HighlightRow[];
    strengthsOpportunities:       string;
    askingSalesPrice:             string;
    expectedSalesPrice:           string;
    projectedMarketingTime:       string;
    pricingParagraph:             string;
    conclusionParagraph:          string;
}

const DEFAULT_HIGHLIGHTS: HighlightRow[] = [
    { id: "h1", key: "Total Building Size:", value: "", isCustom: false },
    { id: "h2", key: "Site Size:",           value: "", isCustom: false },
    { id: "h3", key: "Zoning:",              value: "", isCustom: false },
    { id: "h4", key: "APN:",                 value: "", isCustom: false },
    { id: "h5", key: "2024 Property Taxes:", value: "", isCustom: false },
];

const emptyTile = (): TileFields => ({
    compId: null, addressStatus: "", sfOnAc: "",
    imageFile: null, imageName: "", imagePreviewUrl: null, imageUrl: null,
});

// ─── Tile card ────────────────────────────────────────────────────────────────

function TileCard({
    n, tile, onChange, onPickComp,
}: {
    n: number;
    tile: TileFields;
    onChange: (t: TileFields) => void;
    onPickComp: () => void;
}) {
    const hasComp = Boolean(tile.compId || tile.addressStatus);

    return (
        <div className="flex flex-col gap-1.5 rounded border border-foreground/20 p-2">
            <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Tile {n}
                </p>
                <button
                    type="button"
                    onClick={onPickComp}
                    className="text-[10px] text-foreground/60 hover:text-foreground underline leading-none"
                >
                    {hasComp ? "Change" : "Pick Comp"}
                </button>
            </div>

            {/* Photo — comp image_url or manually uploaded */}
            <label className="relative h-20 cursor-pointer overflow-hidden rounded border border-foreground/20 bg-muted/20 block">
                {tile.imagePreviewUrl ? (
                    <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={tile.imagePreviewUrl}
                            alt={`Tile ${n} photo`}
                            className="h-full w-full object-cover"
                        />
                        <div className="absolute bottom-0 inset-x-0 bg-black/50 px-1 py-0.5">
                            <p className="text-[10px] text-white truncate">
                                {tile.imageName || "comp image"}
                            </p>
                        </div>
                    </>
                ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                        <span className="text-xs">+ Photo</span>
                    </div>
                )}
                <input
                    type="file"
                    accept="image/*"
                    onChange={e => {
                        const file = e.target.files?.[0] ?? null;
                        if (!file) return;
                        onChange({
                            ...tile,
                            imageFile:       file,
                            imageName:       file.name,
                            imagePreviewUrl: URL.createObjectURL(file),
                            imageUrl:        null,
                        });
                    }}
                    className="absolute inset-0 cursor-pointer opacity-0"
                />
            </label>

            <input
                type="text"
                placeholder="Address | Sold"
                value={tile.addressStatus}
                onChange={e => onChange({ ...tile, addressStatus: e.target.value })}
                className="rounded border border-foreground/20 bg-background px-2 py-1 text-xs outline-none focus:border-foreground/40"
            />
            <input
                type="text"
                placeholder="±14,350 SF on ±1.88 AC"
                value={tile.sfOnAc}
                onChange={e => onChange({ ...tile, sfOnAc: e.target.value })}
                className="rounded border border-foreground/20 bg-background px-2 py-1 text-xs outline-none focus:border-foreground/40"
            />
        </div>
    );
}

// ─── PDF Preview pane ─────────────────────────────────────────────────────────

function PdfPreview({ url, loading }: { url: string | null; loading: boolean }) {
    if (loading) {
        return (
            <div className="flex h-full items-center justify-center text-muted-foreground">
                <div className="flex flex-col items-center gap-3">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
                    <span className="text-sm">Rendering…</span>
                </div>
            </div>
        );
    }
    if (!url) {
        return (
            <div className="flex h-full items-center justify-center text-muted-foreground">
                <p className="text-sm">Preview will appear after render</p>
            </div>
        );
    }
    return (
        <iframe
            src={url}
            className="h-full w-full border-0"
            title="BOV Cover + Section 1 preview"
        />
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BovSection1Step() {
    const router = useRouter();
    const { getStep, setStepPdf, setStepFields, confirmStep } = useBovState();

    const cached      = getStep(2);
    const coverFields = getStep(1).fieldValues as { clientName?: string; clientPropertyAddress?: string };

    const saved = cached.fieldValues as Partial<{
        tiles: Omit<TileFields, "imageFile">[];
        similarTransactionsAddress: string;
        clientMention:              string;
        highlights:                 HighlightRow[];
        strengthsOpportunities:     string;
        askingSalesPrice:           string;
        expectedSalesPrice:         string;
        projectedMarketingTime:     string;
        pricingParagraph:           string;
        conclusionParagraph:        string;
    }>;

    const [fields, setFields] = useState<Section1Fields>(() => ({
        tiles: Array.from({ length: 6 }, (_, i) => {
            const s = saved.tiles?.[i];
            return s
                ? { ...emptyTile(), compId: s.compId ?? null, addressStatus: s.addressStatus, sfOnAc: s.sfOnAc, imageName: s.imageName, imagePreviewUrl: s.imagePreviewUrl ?? null, imageUrl: s.imageUrl ?? null }
                : emptyTile();
        }),
        similarTransactionsAddress: saved.similarTransactionsAddress ?? coverFields.clientPropertyAddress ?? "",
        clientMention:              saved.clientMention              ?? coverFields.clientName             ?? "",
        highlights: saved.highlights
            ? saved.highlights.map((h, i) => ({ id: h.id ?? `saved-${i}`, ...h }))
            : DEFAULT_HIGHLIGHTS.map(h => ({ ...h })),
        strengthsOpportunities: saved.strengthsOpportunities ?? "",
        askingSalesPrice:       saved.askingSalesPrice        ?? "",
        expectedSalesPrice:     saved.expectedSalesPrice      ?? "",
        projectedMarketingTime: saved.projectedMarketingTime  ?? "",
        pricingParagraph:       saved.pricingParagraph        ?? "",
        conclusionParagraph:    saved.conclusionParagraph     ?? "",
    }));

    const [currentBytes, setCurrentBytes] = useState<Uint8Array | null>(() => cached.pdfBytes ?? null);
    const [isRendering, setIsRendering]   = useState(!cached.pdfUrl);
    const [renderError, setRenderError]   = useState<string | null>(null);
    const prevBlobRef = useRef<string | null>(null);

    // Comps from DB
    const [comps, setComps]             = useState<Comp[]>([]);
    const [pickingTile, setPickingTile] = useState<number | null>(null);

    useEffect(() => {
        fetch("/api/bov/comps")
            .then(r => r.json())
            .then((data: Comp[]) => setComps(data))
            .catch(() => {});
    }, []);

    const step1Bytes = getStep(1).pdfBytes ?? null;
    const { mergedUrl, isMerging } = useMergedPdf([step1Bytes, currentBytes]);
    const displayUrl = currentBytes ? mergedUrl : null;

    // ── Render helper ──────────────────────────────────────────────────────────

    const doRender = useCallback(async (f: Section1Fields) => {
        setIsRendering(true);
        setRenderError(null);

        const form = new FormData();

        for (let i = 0; i < 6; i++) {
            const tile = f.tiles[i];
            form.append(`tile_${i + 1}_address_status`, tile.addressStatus);
            form.append(`tile_${i + 1}_sf_on_ac`,       tile.sfOnAc);
            if (tile.imageFile) {
                form.append(`tile_${i + 1}_image`, tile.imageFile);
            } else if (tile.imageUrl) {
                form.append(`tile_${i + 1}_image_url`, tile.imageUrl);
            }
        }

        form.append("similar_transactions_address", f.similarTransactionsAddress);
        form.append("client_mention",               f.clientMention);

        form.append(
            "property_highlights_json",
            JSON.stringify(f.highlights.map(h => ({ key: h.key, value: h.value })))
        );

        // Auto-add period to each strength line if missing; drop blank lines
        const strengthsNormalized = f.strengthsOpportunities
            .split("\n")
            .map(line => line.trimEnd())
            .filter(line => line.length > 0)
            .map(line => /[.!?]$/.test(line) ? line : line + ".")
            .join("\n");
        form.append("strengths_opportunities", strengthsNormalized);

        form.append("asking_sales_price",       f.askingSalesPrice);
        form.append("expected_sales_price",     f.expectedSalesPrice);
        form.append("projected_marketing_time", f.projectedMarketingTime);
        form.append("pricing_paragraph",        f.pricingParagraph);
        form.append("conclusion_paragraph",     f.conclusionParagraph);

        try {
            const res = await fetch("/api/bov/section1/render", { method: "POST", body: form });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                setRenderError(err?.error || "Render failed");
                return;
            }

            const bytes  = await res.arrayBuffer();
            const uint8  = new Uint8Array(bytes);
            const blob   = new Blob([uint8], { type: "application/pdf" });
            const newUrl = URL.createObjectURL(blob);

            if (prevBlobRef.current) URL.revokeObjectURL(prevBlobRef.current);
            prevBlobRef.current = newUrl;

            setCurrentBytes(uint8);
            setStepPdf(2, newUrl, uint8);
            setStepFields(2, {
                tiles: f.tiles.map(t => ({
                    compId:          t.compId,
                    addressStatus:   t.addressStatus,
                    sfOnAc:          t.sfOnAc,
                    imageName:       t.imageName,
                    imagePreviewUrl: t.imagePreviewUrl,
                    imageUrl:        t.imageUrl,
                })),
                similarTransactionsAddress: f.similarTransactionsAddress,
                clientMention:              f.clientMention,
                highlights:             f.highlights,
                strengthsOpportunities: f.strengthsOpportunities,
                askingSalesPrice:       f.askingSalesPrice,
                expectedSalesPrice:     f.expectedSalesPrice,
                projectedMarketingTime: f.projectedMarketingTime,
                pricingParagraph:       f.pricingParagraph,
                conclusionParagraph:    f.conclusionParagraph,
            });
        } catch (e: unknown) {
            setRenderError(e instanceof Error ? e.message : "Render failed");
        } finally {
            setIsRendering(false);
        }
    }, [setStepPdf, setStepFields]);

    // ── Auto-render on first visit ─────────────────────────────────────────────

    useEffect(() => {
        if (!cached.pdfUrl) {
            doRender(fields);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Handlers ──────────────────────────────────────────────────────────────

    function updateTile(i: number, updated: TileFields) {
        setFields(prev => {
            const tiles = [...prev.tiles];
            tiles[i] = updated;
            return { ...prev, tiles };
        });
    }

    function selectComp(tileIdx: number, comp: Comp) {
        setFields(prev => {
            const tiles = [...prev.tiles];
            tiles[tileIdx] = {
                ...tiles[tileIdx],
                compId:          comp.id,
                addressStatus:   comp.address + (comp.status ? " | " + comp.status : ""),
                sfOnAc:          formatSfAc(comp.building_sf, comp.land_area),
                imageFile:       null,
                imageName:       comp.address,
                imagePreviewUrl: comp.image_url,
                imageUrl:        comp.image_url,
            };
            return { ...prev, tiles };
        });
    }

    function updateHighlight(i: number, patch: Partial<HighlightRow>) {
        setFields(prev => {
            const highlights = [...prev.highlights];
            highlights[i] = { ...highlights[i], ...patch };
            return { ...prev, highlights };
        });
    }

    function addCustomHighlight() {
        setFields(prev => ({
            ...prev,
            highlights: [...prev.highlights, { id: `custom-${Date.now()}`, key: "", value: "", isCustom: true }],
        }));
    }

    function removeHighlight(i: number) {
        setFields(prev => ({
            ...prev,
            highlights: prev.highlights.filter((_, idx) => idx !== i),
        }));
    }

    function handleNext() {
        confirmStep(2);
        router.push("/bov/step/3");
    }

    const canAddHighlight = fields.highlights.length < 6;

    // ── Render ─────────────────────────────────────────────────────────────────

    return (
        <>
            {/* Comp picker overlay */}
            {pickingTile !== null && (
                <BovCompPicker
                    comps={comps}
                    onSelect={comp => selectComp(pickingTile, comp)}
                    onClose={() => setPickingTile(null)}
                />
            )}

            <div className="grid grid-cols-2 h-[calc(100vh-48px)]">

                {/* ── Left 50%: inputs ──────────────────────────────────────── */}
                <div className="flex flex-col border-r border-foreground/10 overflow-y-auto">

                    {/* Header */}
                    <div className="border-b border-foreground/10 px-5 py-4 shrink-0">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Step 2 of 7</p>
                        <h1 className="mt-0.5 text-lg font-semibold">Section 1</h1>
                    </div>

                    <div className="flex-1 px-5 py-5 flex flex-col gap-8">

                        {/* ── Page 1: Similar Transactions ────────────────────── */}
                        <section className="flex flex-col gap-3">
                            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-foreground/10 pb-1.5">
                                Page 1 — Similar Transactions
                            </h2>

                            {/* Subject property address (replaces placeholder in intro paragraph) */}
                            <label className="flex flex-col gap-1.5">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-sm font-medium">Subject Property Address</span>
                                    <span className="text-xs text-muted-foreground">replaces placeholder in intro paragraph</span>
                                </div>
                                <input
                                    type="text"
                                    placeholder="788 W Illini St"
                                    value={fields.similarTransactionsAddress}
                                    onChange={e => setFields(prev => ({ ...prev, similarTransactionsAddress: e.target.value }))}
                                    className="rounded border border-foreground/20 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
                                />
                            </label>

                            <div className="grid grid-cols-3 gap-2">
                                {fields.tiles.map((tile, i) => (
                                    <TileCard
                                        key={i}
                                        n={i + 1}
                                        tile={tile}
                                        onChange={updated => updateTile(i, updated)}
                                        onPickComp={() => setPickingTile(i)}
                                    />
                                ))}
                            </div>
                        </section>

                        {/* ── Page 2: Executive Summary ────────────────────────── */}
                        <section className="flex flex-col gap-4">
                            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-foreground/10 pb-1.5">
                                Page 2 — Executive Summary
                            </h2>

                            {/* Client name (pink inline name in the template sentence) */}
                            <label className="flex flex-col gap-1.5">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-sm font-medium">Client Name</span>
                                    <span className="text-xs text-muted-foreground">name only — sentence is static in template</span>
                                </div>
                                <input
                                    type="text"
                                    placeholder="THE OPUS GROUP"
                                    value={fields.clientMention}
                                    onChange={e => setFields(prev => ({ ...prev, clientMention: e.target.value }))}
                                    className="rounded border border-foreground/20 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
                                />
                                <p className="text-xs text-muted-foreground/70 leading-snug">
                                    R&amp;G is pleased to present this opinion of value to <span className="text-pink-400 font-medium">{fields.clientMention || "CLIENT NAME"}</span>. Thank you for allowing us this opportunity.
                                </p>
                            </label>

                            {/* Property highlights */}
                            <div className="flex flex-col gap-2">
                                <span className="text-sm font-medium">Property Highlights</span>
                                <div className="flex flex-col gap-1">
                                    {fields.highlights.map((row, i) => (
                                        <div key={row.id} className="flex items-center gap-2">
                                            <input
                                                type="text"
                                                placeholder="Label"
                                                value={row.key}
                                                onChange={e => updateHighlight(i, { key: e.target.value })}
                                                className="w-36 shrink-0 rounded border border-foreground/20 bg-background px-2 py-1.5 text-xs outline-none focus:border-foreground/40"
                                            />
                                            <input
                                                type="text"
                                                placeholder="value"
                                                value={row.value}
                                                onChange={e => updateHighlight(i, { value: e.target.value })}
                                                className="flex-1 rounded border border-foreground/20 bg-background px-2 py-1.5 text-xs outline-none focus:border-foreground/40"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => removeHighlight(i)}
                                                className="text-xs text-muted-foreground hover:text-red-500 leading-none shrink-0"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                    {canAddHighlight && (
                                        <button
                                            type="button"
                                            onClick={addCustomHighlight}
                                            className="mt-0.5 text-xs text-muted-foreground hover:text-foreground text-left"
                                        >
                                            + Add row
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Strengths & opportunities */}
                            <label className="flex flex-col gap-1.5">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-sm font-medium">Strengths &amp; Opportunities</span>
                                    <span className="text-xs text-muted-foreground">one point per line</span>
                                </div>
                                <textarea
                                    rows={5}
                                    placeholder={"Prime location with I-10 visibility\nClear height 24'\nYard space for outdoor storage"}
                                    value={fields.strengthsOpportunities}
                                    onChange={e => setFields(prev => ({ ...prev, strengthsOpportunities: e.target.value }))}
                                    className="rounded border border-foreground/20 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40 resize-y"
                                />
                            </label>
                        </section>

                        {/* ── Page 3: Pricing ───────────────────────────────────── */}
                        <section className="flex flex-col gap-4">
                            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-foreground/10 pb-1.5">
                                Page 3 — Pricing
                            </h2>

                            <label className="flex flex-col gap-1.5">
                                <span className="text-sm font-medium">Asking Sales Price</span>
                                <input
                                    type="text"
                                    placeholder="$2,800,000"
                                    value={fields.askingSalesPrice}
                                    onChange={e => setFields(prev => ({ ...prev, askingSalesPrice: e.target.value }))}
                                    className="rounded border border-foreground/20 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
                                />
                            </label>

                            <label className="flex flex-col gap-1.5">
                                <span className="text-sm font-medium">Expected Sales Price</span>
                                <input
                                    type="text"
                                    placeholder="$2,500,000 — $2,800,000"
                                    value={fields.expectedSalesPrice}
                                    onChange={e => setFields(prev => ({ ...prev, expectedSalesPrice: e.target.value }))}
                                    className="rounded border border-foreground/20 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
                                />
                            </label>

                            <label className="flex flex-col gap-1.5">
                                <span className="text-sm font-medium">Projected Marketing Time</span>
                                <input
                                    type="text"
                                    placeholder="1–6 months"
                                    value={fields.projectedMarketingTime}
                                    onChange={e => setFields(prev => ({ ...prev, projectedMarketingTime: e.target.value }))}
                                    className="rounded border border-foreground/20 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
                                />
                            </label>

                            <label className="flex flex-col gap-1.5">
                                <span className="text-sm font-medium">Pricing Paragraph</span>
                                <textarea
                                    rows={4}
                                    value={fields.pricingParagraph}
                                    onChange={e => setFields(prev => ({ ...prev, pricingParagraph: e.target.value }))}
                                    className="rounded border border-foreground/20 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40 resize-y"
                                />
                            </label>

                            <label className="flex flex-col gap-1.5">
                                <span className="text-sm font-medium">Conclusion Paragraph</span>
                                <textarea
                                    rows={4}
                                    value={fields.conclusionParagraph}
                                    onChange={e => setFields(prev => ({ ...prev, conclusionParagraph: e.target.value }))}
                                    className="rounded border border-foreground/20 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40 resize-y"
                                />
                            </label>
                        </section>
                    </div>

                    {/* Footer: render + next */}
                    <div className="border-t border-foreground/10 px-5 py-4 shrink-0 flex flex-col gap-2">
                        {renderError && (
                            <p className="text-xs text-red-500">
                                {renderError}
                                {renderError.toLowerCase().includes("not found") && (
                                    <span className="block mt-0.5 text-red-400">
                                        Restart the render service to pick up the BOV route.
                                    </span>
                                )}
                            </p>
                        )}
                        <div className="flex items-center justify-between gap-3">
                            <button
                                onClick={() => doRender(fields)}
                                disabled={isRendering}
                                className="rounded-md border border-foreground/20 px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {isRendering ? "Rendering…" : "Render"}
                            </button>
                            <button
                                onClick={handleNext}
                                disabled={!displayUrl || isRendering || isMerging}
                                className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Next →
                            </button>
                        </div>
                    </div>
                </div>

                {/* ── Right 50%: merged PDF preview (cover + section 1) ──────── */}
                <div className="overflow-hidden bg-muted/5">
                    <PdfPreview url={displayUrl} loading={isRendering || isMerging} />
                </div>

            </div>
        </>
    );
}
