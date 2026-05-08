"use client";

/**
 * Client-side state for the three-stage build flow.
 *
 * State persists across navigations within /build/* because the build
 * layout doesn't unmount when the user moves between routes — the
 * provider lives at the layout level. A page refresh resets state to
 * the empty value (refresh-resets-state limitation accepted for v1).
 */

import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import type { Comp } from "@/lib/format";

export interface SelectedTemplate {
    id: string;
    label: string;
    tileCount: number;
    /**
     * Desktop column count for the edit-stage tile grid. Comes from the
     * manifest's `grid.cols`. Undefined when the manifest didn't specify
     * one — the edit page falls back to a count-based heuristic.
     */
    gridCols?: number;
    /**
     * Stage 7.3: list of tile-field names the selected template declares
     * (manifest's `tile_fields[].field`). The edit-stage tile cards use
     * this to decide whether to render optional fields — e.g. the
     * status badge and price line only show when the template includes
     * `status` and `price`. Carried through introspection so the edit
     * page doesn't need a separate manifest fetch.
     */
    tileFieldNames?: string[];
}

export interface BuildState {
    template: SelectedTemplate | null;
    comps: Comp[];
    pageOverrides: Record<string, string>;
}

interface BuildStateContextValue extends BuildState {
    setTemplate(t: SelectedTemplate | null): void;
    setComps(comps: Comp[]): void;
    setPageOverride(field: string, value: string): void;
    reset(): void;
}

const initialState: BuildState = {
    template: null,
    comps: [],
    pageOverrides: {},
};

const BuildStateContext = createContext<BuildStateContextValue | null>(null);

export function BuildStateProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<BuildState>(initialState);

    const setTemplate = useCallback((t: SelectedTemplate | null) => {
        setState((prev) => {
            // Switching templates wipes downstream state — different
            // templates have different tile counts and different page
            // fields. Selecting the same template again is a no-op.
            if (prev.template?.id === t?.id) return prev;
            return { template: t, comps: [], pageOverrides: {} };
        });
    }, []);

    const setComps = useCallback((comps: Comp[]) => {
        setState((prev) => ({ ...prev, comps }));
    }, []);

    const setPageOverride = useCallback((field: string, value: string) => {
        setState((prev) => ({
            ...prev,
            pageOverrides: { ...prev.pageOverrides, [field]: value },
        }));
    }, []);

    const reset = useCallback(() => setState(initialState), []);

    const value = useMemo<BuildStateContextValue>(
        () => ({
            ...state,
            setTemplate,
            setComps,
            setPageOverride,
            reset,
        }),
        [state, setTemplate, setComps, setPageOverride, reset]
    );

    return (
        <BuildStateContext.Provider value={value}>
            {children}
        </BuildStateContext.Provider>
    );
}

export function useBuildState(): BuildStateContextValue {
    const ctx = useContext(BuildStateContext);
    if (!ctx) {
        throw new Error("useBuildState must be used inside <BuildStateProvider>");
    }
    return ctx;
}
