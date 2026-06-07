"use client";

import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useState,
    type ReactNode,
} from "react";

export interface BovStepData {
    /** Blob URL of the rendered PDF, or null if not yet rendered. */
    pdfUrl: string | null;
    /** Raw bytes of the rendered PDF — used for client-side merging. */
    pdfBytes: Uint8Array | null;
    /** True once the user has confirmed this step and moved forward. */
    confirmed: boolean;
    /** Field values entered by the user, keyed by field name. Persists across step navigation. */
    fieldValues: Record<string, unknown>;
}

interface BovState {
    steps: Record<number, BovStepData>;
}

interface BovStateContextValue extends BovState {
    setStepPdf(step: number, url: string | null, bytes?: Uint8Array | null): void;
    setStepFields(step: number, values: Record<string, unknown>): void;
    confirmStep(step: number): void;
    getStep(step: number): BovStepData;
    reset(): void;
}

const empty: BovStepData = { pdfUrl: null, pdfBytes: null, confirmed: false, fieldValues: {} };
const initial: BovState = { steps: {} };
const Ctx = createContext<BovStateContextValue | null>(null);

export function BovStateProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<BovState>(initial);

    const setStepPdf = useCallback((step: number, url: string | null, bytes?: Uint8Array | null) => {
        setState((prev) => ({
            steps: {
                ...prev.steps,
                [step]: { ...empty, ...prev.steps[step], pdfUrl: url, pdfBytes: bytes ?? null },
            },
        }));
    }, []);

    const setStepFields = useCallback((step: number, values: Record<string, unknown>) => {
        setState((prev) => ({
            steps: {
                ...prev.steps,
                [step]: { ...empty, ...prev.steps[step], fieldValues: values },
            },
        }));
    }, []);

    const confirmStep = useCallback((step: number) => {
        setState((prev) => ({
            steps: {
                ...prev.steps,
                [step]: { ...empty, ...prev.steps[step], confirmed: true },
            },
        }));
    }, []);

    const getStep = useCallback(
        (step: number): BovStepData => state.steps[step] ?? empty,
        [state.steps]
    );

    const reset = useCallback(() => setState(initial), []);

    const value = useMemo<BovStateContextValue>(
        () => ({ ...state, setStepPdf, setStepFields, confirmStep, getStep, reset }),
        [state, setStepPdf, setStepFields, confirmStep, getStep, reset]
    );

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBovState(): BovStateContextValue {
    const ctx = useContext(Ctx);
    if (!ctx) throw new Error("useBovState must be used inside <BovStateProvider>");
    return ctx;
}
