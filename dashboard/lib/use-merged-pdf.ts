"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Merges an ordered list of PDF byte arrays into a single PDF and returns a
 * blob URL. Null entries are skipped. Re-merges whenever any entry's reference
 * changes (i.e. when a step re-renders and produces new bytes).
 *
 * Uses a version counter as the merge trigger so the deps array is always
 * length-1 (constant), satisfying React's rules-of-hooks requirement.
 */
export function useMergedPdf(stepBytes: (Uint8Array | null)[]): {
    mergedUrl: string | null;
    isMerging: boolean;
} {
    const [mergedUrl, setMergedUrl] = useState<string | null>(null);
    const [isMerging, setIsMerging] = useState(false);
    const blobRef    = useRef<string | null>(null);
    const latestRef  = useRef(stepBytes);
    const prevRef    = useRef<(Uint8Array | null)[]>([]);
    const [version, setVersion] = useState(0);

    // Keep latestRef in sync every render (safe — refs may be written during render).
    latestRef.current = stepBytes;

    // Detect changes in the bytes array (by reference per element) and bump the
    // version counter. Runs after every render but triggers the merge effect only
    // when something actually changed.
    useEffect(() => {
        const prev = prevRef.current;
        const curr = latestRef.current;
        const changed =
            prev.length !== curr.length ||
            curr.some((b, i) => b !== prev[i]);
        if (changed) {
            prevRef.current = curr.slice();
            setVersion(v => v + 1);
        }
    });

    // Merge whenever version increments — constant-size dep array ✓
    useEffect(() => {
        const bytes = latestRef.current;
        const valid = bytes.filter((b): b is Uint8Array => b != null);

        if (valid.length === 0) {
            setMergedUrl(null);
            return;
        }

        let dead = false;

        (async () => {
            if (valid.length === 1) {
                const url = URL.createObjectURL(
                    new Blob([valid[0]], { type: "application/pdf" })
                );
                if (!dead) {
                    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
                    blobRef.current = url;
                    setMergedUrl(url);
                }
                return;
            }

            setIsMerging(true);
            try {
                const { PDFDocument } = await import("pdf-lib");
                const out = await PDFDocument.create();
                for (const b of valid) {
                    const src    = await PDFDocument.load(b);
                    const copied = await out.copyPages(src, src.getPageIndices());
                    copied.forEach(p => out.addPage(p));
                }
                const merged = await out.save();
                if (!dead) {
                    const url = URL.createObjectURL(
                        new Blob([merged], { type: "application/pdf" })
                    );
                    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
                    blobRef.current = url;
                    setMergedUrl(url);
                }
            } catch (e) {
                console.error("useMergedPdf:", e);
            } finally {
                if (!dead) setIsMerging(false);
            }
        })();

        return () => { dead = true; };
    }, [version]); // single constant-size dep ✓

    return { mergedUrl, isMerging };
}
