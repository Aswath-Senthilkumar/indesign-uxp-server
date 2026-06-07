"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useBovState } from "@/lib/bov-state";

// ─── Section 6 toggle metadata ───────────────────────────────────────────────

const SECTION6_TOGGLES = [
    { frame: "sections_6_recent_industrial_transactions",       label: "Our Team's Recent Industrial Transactions" },
    { frame: "sections_6_recent_heavy_industrial_transactions", label: "Recent Heavy Industrial Transactions"      },
    { frame: "sections_6_nw_phoenix_transactions",              label: "NW Phoenix Industrial Transactions"        },
    { frame: "sections_6_sw_phoenix_transactions",              label: "SW Phoenix Industrial Transactions"        },
    { frame: "sections_6_sky_harbor_transactions",              label: "Sky Harbor Industrial Transactions"        },
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

interface CoverFields {
    coverDate:             string;
    clientName:            string;
    clientPropertyAddress: string;
    imageFile:             File | null;
    imageName:             string;        // display-only, survives nav
    imagePreviewUrl:       string | null; // blob URL, valid in same session
    section6Disabled:      Set<string>;
}

// ─── PDF Preview pane ────────────────────────────────────────────────────────

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
            title="BOV Cover preview"
        />
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BovCoverStep() {
    const router = useRouter();
    const { getStep, setStepPdf, setStepFields, confirmStep } = useBovState();

    const cached = getStep(1);

    // Restore field values from BovState if returning to this step
    const savedFields = cached.fieldValues as Partial<{
        coverDate: string;
        clientName: string;
        clientPropertyAddress: string;
        imageName: string;
        imagePreviewUrl: string;
        section6Disabled: string[];
    }>;

    const [fields, setFields] = useState<CoverFields>({
        coverDate:             savedFields.coverDate             ?? "",
        clientName:            savedFields.clientName            ?? "",
        clientPropertyAddress: savedFields.clientPropertyAddress ?? "",
        imageFile:             null,
        imageName:             savedFields.imageName             ?? "",
        imagePreviewUrl:       savedFields.imagePreviewUrl       ?? null,
        section6Disabled:      new Set(savedFields.section6Disabled ?? []),
    });

    const [previewUrl, setPreviewUrl]   = useState<string | null>(cached.pdfUrl);
    // Start in rendering state on first visit so the spinner shows immediately
    const [isRendering, setIsRendering] = useState(!cached.pdfUrl);
    const [renderError, setRenderError] = useState<string | null>(null);
    const prevBlobRef = useRef<string | null>(null);

    // ── Render helper ────────────────────────────────────────────────────────

    const doRender = useCallback(async (f: CoverFields) => {
        setIsRendering(true);
        setRenderError(null);

        const form = new FormData();
        if (f.coverDate)             form.append("cover_date",              f.coverDate);
        if (f.clientName)            form.append("client_name",             f.clientName);
        if (f.clientPropertyAddress) form.append("client_property_address", f.clientPropertyAddress);
        if (f.imageFile)             form.append("cover_image",             f.imageFile);
        form.append("section6_disabled", JSON.stringify([...f.section6Disabled]));

        try {
            const res = await fetch("/api/bov/cover/render", { method: "POST", body: form });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                const detailMsg = typeof err?.detail === "string" ? err.detail : (err?.detail?.error ?? "");
                setRenderError(detailMsg || err?.error || "Render failed");
                return;
            }

            const bytes  = await res.arrayBuffer();
            const uint8  = new Uint8Array(bytes);
            const blob   = new Blob([uint8], { type: "application/pdf" });
            const newUrl = URL.createObjectURL(blob);

            // Revoke previous blob to avoid memory leaks
            if (prevBlobRef.current) URL.revokeObjectURL(prevBlobRef.current);
            prevBlobRef.current = newUrl;

            setPreviewUrl(newUrl);

            // Persist to BovState (bytes kept for downstream merging)
            setStepPdf(1, newUrl, uint8);
            setStepFields(1, {
                coverDate:             f.coverDate,
                clientName:            f.clientName,
                clientPropertyAddress: f.clientPropertyAddress,
                imageName:             f.imageName,
                imagePreviewUrl:       f.imagePreviewUrl,
                section6Disabled:      [...f.section6Disabled],
            });
        } catch (e: unknown) {
            setRenderError(e instanceof Error ? e.message : "Render failed");
        } finally {
            setIsRendering(false);
        }
    }, [setStepPdf, setStepFields]);

    // ── Auto-render on first visit ───────────────────────────────────────────

    useEffect(() => {
        if (!cached.pdfUrl) {
            doRender(fields);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Handlers ─────────────────────────────────────────────────────────────

    function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0] ?? null;
        if (!file) return;
        const previewUrl = URL.createObjectURL(file);
        setFields(prev => ({ ...prev, imageFile: file, imageName: file.name, imagePreviewUrl: previewUrl }));
    }

    function toggleSection6(frame: string) {
        setFields(prev => {
            const next = new Set(prev.section6Disabled);
            if (next.has(frame)) next.delete(frame);
            else next.add(frame);
            return { ...prev, section6Disabled: next };
        });
    }

    function handleNext() {
        confirmStep(1);
        router.push("/bov/step/2");
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="grid grid-cols-2 h-[calc(100vh-48px)]">

            {/* ── Left 50%: inputs ─────────────────────────────────────────── */}
            <div className="flex flex-col border-r border-foreground/10 overflow-y-auto">

                {/* Header */}
                <div className="border-b border-foreground/10 px-5 py-4 shrink-0">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Step 1 of 7</p>
                    <h1 className="mt-0.5 text-lg font-semibold">Cover</h1>
                </div>

                <div className="flex-1 px-5 py-5 flex flex-col gap-8">

                    {/* ── Page 1 ───────────────────────────────────────────── */}
                    <section className="flex flex-col gap-4">
                        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-foreground/10 pb-1.5">
                            Page 1
                        </h2>

                        {/* Cover image */}
                        <div className="flex flex-col gap-1.5">
                            <span className="text-sm font-medium">Cover Image</span>
                            <label className="relative h-36 cursor-pointer overflow-hidden rounded border border-foreground/20 bg-muted/20 block">
                                {fields.imagePreviewUrl ? (
                                    <>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={fields.imagePreviewUrl}
                                            alt="Cover image preview"
                                            className="h-full w-full object-cover"
                                        />
                                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-2 py-1">
                                            <p className="text-xs text-white truncate">{fields.imageName}</p>
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
                                        <span className="text-2xl">+</span>
                                        <span className="text-xs">Click to upload image</span>
                                    </div>
                                )}
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleImageChange}
                                    className="absolute inset-0 cursor-pointer opacity-0"
                                />
                            </label>
                        </div>

                        {/* Date */}
                        <label className="flex flex-col gap-1.5">
                            <div className="flex items-baseline gap-2">
                                <span className="text-sm font-medium">Date</span>
                                <span className="text-xs text-muted-foreground">MM/DD/YY — 2-digit year</span>
                            </div>
                            <input
                                type="text"
                                placeholder="e.g. 08/26/26"
                                value={fields.coverDate}
                                onChange={e => setFields(prev => ({ ...prev, coverDate: e.target.value }))}
                                className="rounded border border-foreground/20 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
                            />
                        </label>

                        {/* Property address */}
                        <label className="flex flex-col gap-1.5">
                            <span className="text-sm font-medium">Property Address</span>
                            <input
                                type="text"
                                placeholder="e.g. 3693 E Van Buren St. Phoenix, AZ 85008"
                                value={fields.clientPropertyAddress}
                                onChange={e => setFields(prev => ({ ...prev, clientPropertyAddress: e.target.value }))}
                                className="rounded border border-foreground/20 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
                            />
                        </label>

                        {/* Client name */}
                        <label className="flex flex-col gap-1.5">
                            <span className="text-sm font-medium">Client / Organisation</span>
                            <input
                                type="text"
                                placeholder="e.g. The Opus Group"
                                value={fields.clientName}
                                onChange={e => setFields(prev => ({ ...prev, clientName: e.target.value }))}
                                className="rounded border border-foreground/20 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
                            />
                        </label>
                    </section>

                    {/* ── Page 2 ───────────────────────────────────────────── */}
                    <section className="flex flex-col gap-3">
                        <div>
                            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-foreground/10 pb-1.5">
                                Page 2 — Section 6 Contents
                            </h2>
                            <p className="mt-1.5 text-xs text-muted-foreground">
                                LOR and agent qualifications always included. Toggle the transaction sections below.
                            </p>
                        </div>

                        {/* Always-on: Letters of Recommendation (top) */}
                        <div className="flex items-center justify-between rounded border border-foreground/10 bg-muted/20 px-3 py-2 opacity-50">
                            <span className="text-sm">Letters of Recommendation</span>
                            <span className="text-xs text-muted-foreground">Always on</span>
                        </div>

                        {/* Toggleable rows */}
                        {SECTION6_TOGGLES.map(({ frame, label }) => {
                            const isDisabled = fields.section6Disabled.has(frame);
                            return (
                                <button
                                    key={frame}
                                    type="button"
                                    onClick={() => toggleSection6(frame)}
                                    className={`flex items-center justify-between rounded border px-3 py-2 text-left transition-colors ${
                                        isDisabled
                                            ? "border-foreground/10 bg-muted/10 text-muted-foreground line-through"
                                            : "border-foreground/20 bg-background hover:bg-muted/20"
                                    }`}
                                >
                                    <span className="text-sm">{label}</span>
                                    <span className={`ml-3 shrink-0 text-xs font-medium ${isDisabled ? "text-foreground/30" : "text-foreground/60"}`}>
                                        {isDisabled ? "✕ off" : "✓ on"}
                                    </span>
                                </button>
                            );
                        })}

                        {/* Always-on: Agent Qualifications (bottom) */}
                        <div className="flex items-center justify-between rounded border border-foreground/10 bg-muted/20 px-3 py-2 opacity-50">
                            <span className="text-sm">Agent Qualifications</span>
                            <span className="text-xs text-muted-foreground">Always on</span>
                        </div>
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
                            disabled={!previewUrl || isRendering}
                            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Next →
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Right 50%: PDF preview ───────────────────────────────────── */}
            <div className="overflow-hidden bg-muted/5">
                <PdfPreview url={previewUrl} loading={isRendering && !previewUrl} />
            </div>

        </div>
    );
}
